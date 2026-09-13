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

describe('script steps the conversational e2e needs (Phase 13)', () => {
  it('a step can take time, so a person can act while the assistant is still deciding', async () => {
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: script({ turns: { slow: [{ text: 'done', delayMs: 120 }] } }) });
    const started = Date.now();
    await model?.messages.stream({ messages: [{ role: 'user', content: 'slow' }] } as never).finalMessage();
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('a delay is abandoned when the turn is cancelled', async () => {
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: script({ turns: { slow: [{ text: 'done', delayMs: 5000 }] } }) });
    const abort = new AbortController();
    const reply = model?.messages.stream({ messages: [{ role: 'user', content: 'slow' }] } as never, { signal: abort.signal }).finalMessage();
    setTimeout(() => abort.abort(), 20);
    const started = Date.now();
    await expect(reply).rejects.toThrow(/abort/i);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a text step can repeat what the last tool answered, as a model reporting it would', async () => {
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: script({ turns: { 'what did you do': [{ tool: 'activity.describeRecent' }, { text: 'Recent: {{lastResult}}' }] } }) });
    const messages = [
      { role: 'user', content: 'what did you do' },
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{"ok":true,"value":{"text":"Paused"}}' }] },
    ];
    const reply = await model?.messages.stream({ messages } as never).finalMessage();
    expect(reply?.content[0]).toMatchObject({ type: 'text', text: 'Recent: {"ok":true,"value":{"text":"Paused"}}' });
  });

  it('a tool input can use a value the last tool returned, as a model using an id it just read would', async () => {
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: script({ turns: { remove: [
      { tool: 'curation.getCollections' },
      { tool: 'curation.removeFromCollection', input: { collectionId: '{{lastResult:value.collections.0.collectionId}}', videoIds: ['abc'] } },
    ] } }) });
    const messages = [
      { role: 'user', content: 'remove' },
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{"ok":true,"value":{"collections":[{"collectionId":"col-42","name":"Favourites"}]}}' }] },
    ];
    const reply = await model?.messages.stream({ messages } as never).finalMessage();
    expect(reply?.content[0]).toMatchObject({ type: 'tool_use', input: { collectionId: 'col-42', videoIds: ['abc'] } });
  });

  it('a path the last result does not have is refused loudly, not sent as an empty id', async () => {
    const model = modelFromEnvironment({ AMR_SCRIPTED_MODEL: script({ turns: { remove: [
      { tool: 'queue.get' },
      { tool: 'curation.deleteCollection', input: { collectionId: '{{lastResult:value.collections.0.collectionId}}' } },
    ] } }) });
    const messages = [
      { role: 'user', content: 'remove' },
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{"ok":true,"value":{}}' }] },
    ];
    await expect(model?.messages.stream({ messages } as never).finalMessage()).rejects.toThrow(/value\.collections\.0\.collectionId/);
  });
});
