import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn, type ToolTransport } from '../../server/agent/loop.ts';
import { buildToolNameMap, ToolNameCollision, API_TOOL_NAME } from '../../server/agent/tool-names.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';

describe('Gate C round 2', () => {
  it('every declared tool name becomes a valid API name', () => {
    const all = Object.values(TOOL);
    const map = buildToolNameMap(all);
    for (const name of all) {
      const alias = map.toApi.get(name);
      expect(alias, name).toBeDefined();
      expect(API_TOOL_NAME.test(alias as string), `${name} -> ${String(alias)}`).toBe(true);
      expect(map.fromApi.get(alias as string)).toBe(name);
    }
  });

  it('dotted names would have been rejected by the API unchanged', () => {
    expect(API_TOOL_NAME.test('playback.pause')).toBe(false);
    expect(API_TOOL_NAME.test(buildToolNameMap(['playback.pause']).toApi.get('playback.pause') as string)).toBe(true);
  });

  it('refuses a collision rather than routing a call to the wrong tool', () => {
    expect(() => buildToolNameMap(['a.b', 'a:b'])).toThrow(ToolNameCollision);
  });

  it('calls the transport with the application name, not the alias', async () => {
    const called: string[] = [];
    const t: ToolTransport = {
      listTools: async () => [{ name: 'playback.pause', description: 'p', inputSchema: { type: 'object' } }],
      callTool: async (n) => {
        called.push(n);
        return { ok: true, value: null };
      },
    };
    let i = 0;
    const responses = [
      { content: [{ type: 'tool_use', id: 't1', name: 'playback__pause', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ] as unknown as Anthropic.Message[];
    const client = {
      messages: { stream: () => ({ finalMessage: async () => responses[i++] }) },
    } as unknown as Anthropic;
    await runAgentTurn(client, t, 'pause');
    expect(called).toEqual(['playback.pause']);
  });

  it('finalises with the previous schemas when every tool vanishes mid-turn', async () => {
    // Regression for the round-3 finding: sending tools: [] alongside a
    // transcript that already holds tool_use blocks is a 400.
    let call = 0;
    const t: ToolTransport = {
      listTools: async () =>
        call === 0 ? [{ name: 'playback.pause', description: 'p', inputSchema: { type: 'object' } }] : [],
      callTool: async () => ({ ok: true, value: null }),
    };
    const sent: { tools: unknown[]; tool_choice?: unknown }[] = [];
    let i = 0;
    const responses = [
      { content: [{ type: 'tool_use', id: 't1', name: 'playback__pause', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Paused, and that view has closed.' }], stop_reason: 'end_turn' },
    ] as unknown as Anthropic.Message[];
    const client = {
      messages: {
        stream: (p: { tools: unknown[]; tool_choice?: unknown }) => {
          sent.push(p);
          call += 1;
          return { finalMessage: async () => responses[i++] };
        },
      },
    } as unknown as Anthropic;
    const r = await runAgentTurn(client, t, 'pause');
    expect(sent[1]?.tools).toHaveLength(1);
    expect(sent[1]?.tool_choice).toEqual({ type: 'none' });
    expect(r.text).toContain('Paused');
  });

  it('re-queries the tool list on every iteration, not once per turn', async () => {
    let lists = 0;
    const t: ToolTransport = {
      listTools: async () => {
        lists += 1;
        return [{ name: 'playback.pause', description: 'p', inputSchema: { type: 'object' } }];
      },
      callTool: async () => ({ ok: true, value: null }),
    };
    let i = 0;
    const responses = [
      { content: [{ type: 'tool_use', id: 't1', name: 'playback__pause', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'tool_use', id: 't2', name: 'playback__pause', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ] as unknown as Anthropic.Message[];
    const client = {
      messages: { stream: () => ({ finalMessage: async () => responses[i++] }) },
    } as unknown as Anthropic;
    await runAgentTurn(client, t, 'pause twice');
    expect(lists).toBe(3);
  });
});
