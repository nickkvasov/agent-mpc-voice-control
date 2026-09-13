import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from './loop.ts';

/**
 * A scripted model for deterministic end-to-end runs (T131, research R9).
 *
 * Enabled only by `AMR_SCRIPTED_MODEL=<path to script.json>`, and REFUSING to
 * start when `ANTHROPIC_API_KEY` is also set: a scripted run must never be
 * mistaken for a live one, and a live key present beside a script is exactly
 * the configuration where that mistake happens.
 *
 * Script: `{ "turns": { "<command text>": [ { "tool": "playback.seek", "input": {…} }, { "text": "…" } ] } }`.
 * Each model request in a turn takes the next step; tool names are the
 * application's and are sent under their API alias, as the real API would.
 */
export class ScriptedModelRefused extends Error {}

type Step = { readonly tool: string; readonly input?: Record<string, unknown> } | { readonly text: string };

interface Script {
  readonly turns: Readonly<Record<string, readonly Step[]>>;
}

export function modelFromEnvironment(env: Readonly<Record<string, string | undefined>>): Anthropic | null {
  const scriptPath = (env['AMR_SCRIPTED_MODEL'] ?? '').trim();
  const key = (env['ANTHROPIC_API_KEY'] ?? '').trim();
  if (scriptPath !== '') {
    if (key !== '') {
      throw new ScriptedModelRefused('AMR_SCRIPTED_MODEL and ANTHROPIC_API_KEY are both set. A scripted run must not run beside a real key; unset one.');
    }
    return scriptedClient(loadScript(scriptPath));
  }
  return key === '' ? null : createClient({ apiKey: key });
}

function loadScript(path: string): Script {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`The scripted model's script at ${path} could not be read as JSON`, { cause });
  }
  const turns = (parsed as { turns?: unknown } | null)?.turns;
  if (turns === null || typeof turns !== 'object') throw new Error(`The script at ${path} has no "turns" object`);
  return { turns: turns as Script['turns'] };
}

const alias = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '__');

function scriptedClient(script: Script): Anthropic {
  let counter = 0;
  const reply = (params: { messages: readonly { role: string; content: unknown }[] }): Anthropic.Message => {
    const first = params.messages[0];
    const command = typeof first?.content === 'string' ? first.content : '';
    // Which step: one per assistant message already in this conversation.
    const at = params.messages.filter((m) => m.role === 'assistant').length;
    const step = script.turns[command]?.[at];
    counter += 1;
    const base = { id: `msg_scripted_${String(counter)}`, type: 'message', role: 'assistant', model: 'scripted', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
    if (step === undefined) {
      return { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: `There is no scripted reply for "${command}" at step ${String(at)}.` }] } as unknown as Anthropic.Message;
    }
    if ('tool' in step) {
      return { ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_scripted_${String(counter)}`, name: alias(step.tool), input: step.input ?? {} }] } as unknown as Anthropic.Message;
    }
    return { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: step.text }] } as unknown as Anthropic.Message;
  };
  return {
    messages: {
      stream: (params: { messages: readonly { role: string; content: unknown }[] }, options?: { signal?: AbortSignal }) => ({
        finalMessage: () =>
          new Promise<Anthropic.Message>((resolve, reject) => {
            if (options?.signal?.aborted === true) {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              return;
            }
            resolve(reply(params));
          }),
      }),
    },
  } as unknown as Anthropic;
}
