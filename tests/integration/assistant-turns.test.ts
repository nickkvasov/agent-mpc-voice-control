import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Anthropic from '@anthropic-ai/sdk';
import { attachGateway, type Gateway } from '../../server/gateway/upgrade.ts';
import { __resetTickets, mintTicket } from '../../server/ticket/route.ts';
import { AssistantAllowance } from '../../server/assistant/allowance.ts';
import { handleTurn, TURNS_PATH } from '../../server/assistant/turns.ts';
import { dialPage, type FakeTool } from '../support/fake-page.ts';
import { COMMAND_ID_FIELD } from '../../src/mcp/command-id.ts';

/**
 * T127 — POST /api/assistant/turns, end to end on a real socket: the real
 * gateway, a page that is a real MCP server, and a scripted model client.
 */
const SESSION = '0b0e8a0e-1111-4222-8333-444455556666';
const COOKIE = `vvc_session=${SESSION}`;

type Scripted = Anthropic.Message;
const say = (text: string): Scripted => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) as Scripted;
const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Scripted =>
  ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' }) as Scripted;

/** A model client replaying responses per conversation, honouring the request's abort signal. */
function scriptedModel(byText: Record<string, Scripted[]>, options: { hangOn?: string } = {}) {
  const requests: { params: Record<string, unknown>; signal: AbortSignal | undefined }[] = [];
  const cursors = new Map<string, number>();
  const client = {
    messages: {
      stream: (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => {
        requests.push({ params, signal: opts?.signal });
        const messages = params['messages'] as { content: unknown }[];
        const text = String(messages[0]?.content);
        const at = cursors.get(text) ?? 0;
        cursors.set(text, at + 1);
        return {
          finalMessage: () =>
            new Promise<Scripted>((resolve, reject) => {
              opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
              if (text === options.hangOn) return;
              resolve(byText[text]?.[at] ?? say('(script exhausted)'));
            }),
        };
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

let http: HttpServer | undefined;
let gateway: Gateway | undefined;

async function start(model: Anthropic | null, allowance = new AssistantAllowance({ perSession: 10, perDay: 100 })) {
  __resetTickets();
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if (req.method === 'POST' && req.url === TURNS_PATH) {
        await handleTurn(req, res, body, { gateway: gw, allowance, model: () => model });
        return;
      }
      res.writeHead(404).end();
    })();
  });
  const gw = attachGateway(server);
  http = server;
  gateway = gw;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { origin: `ws://127.0.0.1:${String(port)}`, base: `http://127.0.0.1:${String(port)}` };
}

afterEach(async () => {
  await gateway?.close();
  await new Promise<void>((r) => (http === undefined ? r() : http.close(() => r())));
});

async function connectTab(origin: string, tabId: string, tools: FakeTool[]) {
  const dialed = await dialPage(mintTicket(origin, SESSION, tabId).url, tools);
  if (!('page' in dialed)) throw new Error('refused');
  await gateway?.waitFor(SESSION, tabId, 2000);
  return dialed.page;
}

async function postTurn(base: string, body: Record<string, unknown>, init: { signal?: AbortSignal; cookie?: string } = {}) {
  return fetch(`${base}${TURNS_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: init.cookie ?? COOKIE },
    body: JSON.stringify(body),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
}

function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  return text.split('\n\n').filter((b) => b.trim() !== '').map((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
    const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>;
    return { event, data };
  });
}

const seekTool = (log: unknown[]): FakeTool => ({
  name: 'playback.seek',
  description: 'Seek',
  inputSchema: { type: 'object', properties: { mode: { type: 'string' }, seconds: { type: 'number' }, [COMMAND_ID_FIELD]: { type: 'string' } }, required: ['mode', 'seconds', COMMAND_ID_FIELD] },
  handler: (args) => { log.push(args); return { ok: true, value: { positionSeconds: 302 } }; },
});

describe('assistant turns (T127)', () => {
  it('streams events in order with done last, and injects the turn\'s commandId over anything the model sent', async () => {
    const calls: unknown[] = [];
    const model = scriptedModel({ 'go back a bit': [use('playback__seek', { mode: 'relative', seconds: -10, [COMMAND_ID_FIELD]: 'cmd-forged' }), say('Went back ten seconds.')] });
    const { origin, base } = await start(model.client);
    await connectTab(origin, 'tab-1', [seekTool(calls)]);

    const res = await postTurn(base, { commandId: 'cmd-7', tabId: 'tab-1', text: 'go back a bit' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    expect(events.map((e) => e.event)).toEqual(['acknowledged', 'tool_call', 'tool_result', 'message', 'done']);
    expect(events[1]?.data).toMatchObject({ toolName: 'playback.seek' });
    expect(events[2]?.data).toMatchObject({ toolName: 'playback.seek', ok: true });
    expect(events.at(-1)?.data).toMatchObject({ stopReason: 'end_turn' });
    // The page received the TURN's id, not the model's forgery.
    expect(calls).toEqual([{ mode: 'relative', seconds: -10, [COMMAND_ID_FIELD]: 'cmd-7' }]);
  });

  it('never shows the model the reserved field', async () => {
    const model = scriptedModel({ hi: [say('hello')] });
    const { origin, base } = await start(model.client);
    await connectTab(origin, 'tab-1', [seekTool([])]);
    await (await postTurn(base, { commandId: 'cmd-1', tabId: 'tab-1', text: 'hi' })).text();
    const tools = model.requests[0]?.params['tools'] as { input_schema: { properties: Record<string, unknown>; required: string[] } }[];
    expect(tools[0]?.input_schema.properties).not.toHaveProperty(COMMAND_ID_FIELD);
    expect(tools[0]?.input_schema.required).not.toContain(COMMAND_ID_FIELD);
  });

  it('refuses before the stream opens: no connection for the tab (409), no model (503), allowance spent (429)', async () => {
    const model = scriptedModel({});
    const spent = new AssistantAllowance({ perSession: 1, perDay: 100 });
    spent.admit(SESSION);
    const { origin, base } = await start(model.client, spent);
    const noTab = await postTurn(base, { commandId: 'c', tabId: 'tab-nowhere', text: 'x' });
    expect(noTab.status).toBe(409);
    expect(await noTab.json()).toMatchObject({ reason: 'assistant_unavailable' });

    await connectTab(origin, 'tab-1', [seekTool([])]);
    const overLimit = await postTurn(base, { commandId: 'c', tabId: 'tab-1', text: 'x' });
    expect(overLimit.status).toBe(429);
    expect(await overLimit.json()).toMatchObject({ reason: 'assistant_allowance_spent', limit: 'session' });

    const noSession = await postTurn(base, { commandId: 'c', tabId: 'tab-1', text: 'x' }, { cookie: '' });
    expect(noSession.status).toBe(409);
  });

  it('503 when there is no model credential', async () => {
    const { origin, base } = await start(null);
    await connectTab(origin, 'tab-1', [seekTool([])]);
    const r = await postTurn(base, { commandId: 'c', tabId: 'tab-1', text: 'x' });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ reason: 'agent_unavailable' });
  });

  it('two concurrent turns each reach the page under their own commandId', async () => {
    const calls: { commandId?: unknown }[] = [];
    const model = scriptedModel({
      one: [use('playback__seek', { mode: 'relative', seconds: 5 }, 'tu_1'), say('one')],
      two: [use('playback__seek', { mode: 'relative', seconds: 5 }, 'tu_2'), say('two')],
    });
    const { origin, base } = await start(model.client);
    await connectTab(origin, 'tab-1', [seekTool(calls as unknown[])]);
    await Promise.all([
      postTurn(base, { commandId: 'cmd-one', tabId: 'tab-1', text: 'one' }).then((r) => r.text()),
      postTurn(base, { commandId: 'cmd-two', tabId: 'tab-1', text: 'two' }).then((r) => r.text()),
    ]);
    expect(calls.map((c) => c[COMMAND_ID_FIELD as 'commandId']).sort()).toEqual(['cmd-one', 'cmd-two']);
  });

  it('aborting the request aborts the model stream, and cancels a tool call already running on the page', async () => {
    let pageSawAbort = false;
    let started!: () => void;
    const toolStarted = new Promise<void>((r) => { started = r; });
    const slow: FakeTool = {
      name: 'catalog.search', description: 'Search', inputSchema: { type: 'object' },
      handler: (_args, signal) => new Promise((resolve) => {
        started();
        signal?.addEventListener('abort', () => { pageSawAbort = true; resolve({ ok: false, reason: 'command_cancelled', detail: 'cancelled' }); });
      }),
    };
    const model = scriptedModel({ search: [use('catalog__search', { query: 'x' }), say('never')] });
    const { origin, base } = await start(model.client);
    await connectTab(origin, 'tab-1', [slow]);
    const controller = new AbortController();
    const pending = postTurn(base, { commandId: 'cmd-c', tabId: 'tab-1', text: 'search' }, { signal: controller.signal })
      .then((r) => r.text()).catch(() => 'aborted');
    await toolStarted;
    controller.abort();
    await pending;
    await new Promise((r) => setTimeout(r, 100));
    expect(pageSawAbort).toBe(true);
  });

  it('a request with an unusable body is refused by name', async () => {
    const { base } = await start(scriptedModel({}).client);
    const r = await postTurn(base, { tabId: 'tab-1' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ reason: 'invalid_turn' });
  });
});
