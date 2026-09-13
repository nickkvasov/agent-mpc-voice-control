import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, createClient, AGENT_MODEL, type ToolTransport } from '../../server/agent/loop.ts';
import { VIEW_OF_TOOL } from '../../src/mcp/tool-availability.ts';

/** A client that replays scripted responses; no network, no key. */
function fakeClient(responses: Anthropic.Message[]): { client: Anthropic; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  const client = {
    messages: {
      stream: (params: unknown) => {
        calls.push(params);
        const r = responses[i++];
        return { finalMessage: async () => r };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const say = (text: string): Anthropic.Message =>
  ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) as Anthropic.Message;

const use = (name: string, input: unknown): Anthropic.Message =>
  ({ content: [{ type: 'tool_use', id: `tu_${name}`, name, input }], stop_reason: 'tool_use' }) as Anthropic.Message;

const transport = (outcome: Awaited<ReturnType<ToolTransport['callTool']>>): ToolTransport & { called: string[] } => {
  const called: string[] = [];
  return {
    called,
    listTools: async () => [{ name: 'playback.pause', description: 'Pause', inputSchema: { type: 'object' } }],
    callTool: async (n) => {
      called.push(n);
      return outcome;
    },
  };
};

describe('agent turn', () => {
  it('runs a tool the model asks for and feeds the result back', async () => {
    const { client, calls } = fakeClient([use('playback.pause', {}), say('Paused.')]);
    const t = transport({ ok: true, value: { paused: true } });
    const r = await runAgentTurn(client, t, 'pause');
    expect(t.called).toEqual(['playback.pause']);
    expect(r.text).toBe('Paused.');
    expect(r.toolCalls).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('uses the configured model with adaptive thinking', async () => {
    const { client, calls } = fakeClient([say('ok')]);
    await runAgentTurn(client, transport({ ok: true, value: null }), 'hi');
    const p = calls[0] as { model: string; thinking: { type: string } };
    expect(p.model).toBe(AGENT_MODEL);
    expect(p.thinking.type).toBe('adaptive');
  });

  it('marks a refusal as an error so the model cannot read it as success', async () => {
    const { client, calls } = fakeClient([use('playback.pause', {}), say('Nothing is playing.')]);
    await runAgentTurn(client, transport({ ok: false, reason: 'not_playing', detail: 'Nothing is playing.' }), 'pause');
    const second = calls[1] as { messages: { role: string; content: unknown }[] };
    const results = second.messages.at(-1)?.content as { is_error: boolean }[];
    expect(results[0]?.is_error).toBe(true);
  });

  it('reports hitting the iteration bound rather than truncating silently', async () => {
    const { client } = fakeClient(Array.from({ length: 12 }, () => use('playback.pause', {})));
    const r = await runAgentTurn(client, transport({ ok: true, value: null }), 'loop');
    expect(r.stopReason).toBe('iteration_limit');
  });

  it('refuses to build a client with no key rather than failing later', () => {
    expect(() => createClient({ apiKey: '  ' })).toThrow(/cannot start/);
  });

  it('asks the page which tools exist right now, every turn', async () => {
    const { client } = fakeClient([say('ok')]);
    const t = transport({ ok: true, value: null });
    const spy = vi.spyOn(t, 'listTools');
    await runAgentTurn(client, t, 'hi');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('a tool that left the listing mid-turn is still called by its application name, so the page can say its view closed (T136)', async () => {
    // The model saw catalog.resolveReference in the first step; the results view closed before the second.
    const { client } = fakeClient([use('playback__pause', {}), use('catalog__resolveReference', { reference: 'the first one' }), say('ok')]);
    const called: string[] = [];
    let listings = 0;
    const t: ToolTransport = {
      listTools: async () => {
        listings += 1;
        const pause = { name: 'playback.pause', description: 'Pause', inputSchema: { type: 'object' } };
        return listings === 1 ? [pause, { name: 'catalog.resolveReference', description: 'Resolve', inputSchema: { type: 'object' } }] : [pause];
      },
      callTool: async (n) => {
        called.push(n);
        return { ok: true, value: null };
      },
    };
    await runAgentTurn(client, t, 'play the first one');
    expect(called).toEqual(['playback.pause', 'catalog.resolveReference']);
  });

  it('tells the model which view provides which tools, so an absent tool can be named as a view to open (FR-035, T139)', async () => {
    const { client, calls } = fakeClient([say('ok')]);
    await runAgentTurn(client, transport({ ok: true, value: null }), 'play the third one');
    const system = String((calls[0] as { system: unknown }).system);
    for (const [prefix, view] of Object.entries(VIEW_OF_TOOL)) {
      expect(system).toContain(`${view} (${prefix}*)`);
    }
  });

  it('asks for precise calls and a short reply, since the page already shows the result (R9 lever 1, T140)', async () => {
    const { client, calls } = fakeClient([say('ok')]);
    await runAgentTurn(client, transport({ ok: true, value: null }), 'find talks about parsing');
    const system = String((calls[0] as { system: unknown }).system);
    expect(system).toMatch(/in parallel/);
    expect(system).toMatch(/one or two short sentences/);
    expect(system).toMatch(/do not list or summarise/i);
  });
});
