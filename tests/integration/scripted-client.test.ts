import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelFromEnvironment, ScriptedModelRefused } from '../../server/agent/scripted-client.ts';

/** T131 — deterministic model for e2e runs, which can never pass itself off as a live one. */
function script(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'scripted-'));
  const path = join(dir, 'script.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('model selection from the environment', () => {
  it('refuses to start a scripted model when a real key is also set', () => {
    const path = script({ turns: {} });
    expect(() => modelFromEnvironment({ AMR_SCRIPTED_MODEL: path, ANTHROPIC_API_KEY: 'sk-ant-real' })).toThrow(ScriptedModelRefused);
  });

  it('is null with neither — the assistant is unavailable, stated, never faked', () => {
    expect(modelFromEnvironment({})).toBeNull();
  });

  it('replays a scripted turn: tool calls under their API alias, then text', async () => {
    const path = script({ turns: { 'go back a bit': [{ tool: 'playback.seek', input: { mode: 'relative', seconds: -10 } }, { text: 'Went back ten seconds.' }] } });
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: path });
    if (model === null) throw new Error('expected a scripted model');
    const params = { messages: [{ role: 'user', content: 'go back a bit' }] };
    const first = await model.messages.stream(params as never).finalMessage();
    expect(first.content[0]).toMatchObject({ type: 'tool_use', name: 'playback__seek', input: { mode: 'relative', seconds: -10 } });
    expect(first.stop_reason).toBe('tool_use');
    const second = await model.messages.stream({ messages: [...params.messages, { role: 'assistant', content: first.content }, { role: 'user', content: [] }] } as never).finalMessage();
    expect(second.content[0]).toMatchObject({ type: 'text', text: 'Went back ten seconds.' });
  });

  it('a command the script does not know gets a stated refusal-shaped reply, not silence', async () => {
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: script({ turns: {} }) });
    const reply = await model?.messages.stream({ messages: [{ role: 'user', content: 'unscripted' }] } as never).finalMessage();
    expect(reply?.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(reply?.content)).toContain('no scripted reply');
  });

  it('a script that does not parse is refused loudly at startup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scripted-'));
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{ not json');
    expect(() => modelFromEnvironment({ AMR_SCRIPTED_MODEL: path })).toThrow(/script/);
  });
});
