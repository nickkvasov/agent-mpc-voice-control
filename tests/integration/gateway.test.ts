import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { attachGateway, type Gateway } from '../../server/gateway/upgrade.ts';
import { __resetTickets, mintTicket } from '../../server/ticket/route.ts';
import { dialPage, type FakeTool } from '../support/fake-page.ts';

/**
 * T118 — the gateway on a real `ws` server bound to an ephemeral port (R6).
 * Never only an in-process transport: the security property lives at the
 * HTTP upgrade, which an in-process test does not have.
 */
const pause: FakeTool = { name: 'playback.pause', description: 'Pause', inputSchema: { type: 'object' }, handler: () => ({ ok: true, value: 'paused' }) };

let http: HttpServer | undefined;
let gateway: Gateway | undefined;

async function start(options: { initializeTimeoutMs?: number } = {}) {
  __resetTickets();
  http = createServer();
  gateway = attachGateway(http, options);
  await new Promise<void>((r) => http?.listen(0, '127.0.0.1', () => r()));
  const { port } = http.address() as AddressInfo;
  return { origin: `ws://127.0.0.1:${String(port)}` };
}

afterEach(async () => {
  await gateway?.close();
  await new Promise<void>((r) => (http === undefined ? r() : http.close(() => r())));
  http = undefined;
  gateway = undefined;
});

describe('gateway upgrade (T118)', () => {
  it('admits a valid ticket, binds the connection to its session, and is ready only after initialize', async () => {
    const { origin } = await start();
    const { url } = mintTicket(origin, 'session-1', 'tab-1');
    const dialed = await dialPage(url, [pause]);
    if (!('page' in dialed)) throw new Error(`refused ${String(dialed.refused)}`);
    const connection = await gateway?.waitFor('session-1', 'tab-1', 2000);
    expect(connection?.sessionId).toBe('session-1');
    expect(connection?.tabId).toBe('tab-1');
    expect((await connection?.listTools())?.map((t) => t.name)).toEqual(['playback.pause']);
    dialed.page.close();
  });

  it.each([
    ['unknown', (origin: string) => `${origin}/mcp?ticket=not-a-ticket`],
    ['replayed', (origin: string) => mintTicket(origin, 'session-2', 'tab-1').url],
  ])('refuses a %s ticket with HTTP 401 before the handshake — the page never sees open', async (kind, makeUrl) => {
    const { origin } = await start();
    const url = makeUrl(origin);
    if (kind === 'replayed') {
      const first = await dialPage(url, [pause]);
      if ('page' in first) first.page.close();
    }
    const opened: boolean[] = [];
    const socket = new WebSocket(url);
    socket.on('open', () => opened.push(true));
    const status = await new Promise<number>((resolve) => {
      socket.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.once('error', () => resolve(-1));
    });
    expect(status).toBe(401);
    expect(opened).toEqual([]);
  });

  it('refuses an expired ticket with 401', async () => {
    const { origin } = await start();
    const realNow = Date.now;
    const { url } = mintTicket(origin, 'session-3', 'tab-1');
    Date.now = () => realNow() + 10 * 60_000;
    try {
      const dialed = await dialPage(url, [pause]);
      expect(dialed).toEqual({ refused: 401 });
    } finally {
      Date.now = realNow;
    }
  });

  it('refuses an upgrade on any path but /mcp', async () => {
    const { origin } = await start();
    const { url } = mintTicket(origin, 'session-4', 'tab-1');
    const dialed = await dialPage(url.replace('/mcp?', '/elsewhere?'), [pause]);
    expect(dialed).toEqual({ refused: 404 });
  });

  it('reports and drops a frame that is not JSON-RPC, and the connection keeps working', async () => {
    const { origin } = await start();
    const errors: unknown[] = [];
    gateway?.onFrameError((cause) => errors.push(cause));
    const dialed = await dialPage(mintTicket(origin, 'session-5', 'tab-1').url, [pause]);
    if (!('page' in dialed)) throw new Error('refused');
    const connection = await gateway?.waitFor('session-5', 'tab-1', 2000);
    dialed.page.socket.send('{"not":"json-rpc"}');
    dialed.page.socket.send('not json at all');
    await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBe(2);
    expect(String(errors[0])).toContain('not JSON-RPC');
    expect(await connection?.callTool('playback.pause', { commandId: 'cmd-1' })).toEqual({ ok: true, value: 'paused' });
    dialed.page.close();
  });

  it('a connection that closes is gone, exactly once, however it ended', async () => {
    const { origin } = await start();
    const closed: string[] = [];
    gateway?.onClosed((sessionId, tabId) => closed.push(`${sessionId}/${tabId}`));
    const dialed = await dialPage(mintTicket(origin, 'session-6', 'tab-1').url, [pause]);
    if (!('page' in dialed)) throw new Error('refused');
    await gateway?.waitFor('session-6', 'tab-1', 2000);
    dialed.page.socket.terminate();
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toEqual(['session-6/tab-1']);
    expect(gateway?.connectionFor('session-6', 'tab-1')).toBeUndefined();
  });
});
