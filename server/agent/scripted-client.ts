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
 *
 * Two additions for the conversational e2e (Phase 13): any step may carry
 * `delayMs` — the model taking time, so a person can act first (FR-038) — and a
 * text step may contain `{{lastResult}}`, replaced by what the last tool
 * answered, as a model reporting it would ("what did you just do?"). A tool
 * input string that is exactly `{{lastResult:<dot.path>}}` becomes the value at
 * that path in the last tool result — a model using an id it just read.
 */
export class ScriptedModelRefused extends Error {}

type Step = ({ readonly tool: string; readonly input?: Record<string, unknown> } | { readonly text: string }) & { readonly delayMs?: number };

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
      const input = withResultValues(step.input ?? {}, params.messages);
      return { ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_scripted_${String(counter)}`, name: alias(step.tool), input }] } as unknown as Anthropic.Message;
    }
    return { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: step.text.replaceAll('{{lastResult}}', lastToolResult(params.messages)) }] } as unknown as Anthropic.Message;
  };
  const delayOf = (params: { messages: readonly { role: string; content: unknown }[] }): number => {
    const first = params.messages[0];
    const command = typeof first?.content === 'string' ? first.content : '';
    return script.turns[command]?.[params.messages.filter((m) => m.role === 'assistant').length]?.delayMs ?? 0;
  };
  return {
    messages: {
      stream: (params: { messages: readonly { role: string; content: unknown }[] }, options?: { signal?: AbortSignal }) => ({
        finalMessage: () =>
          new Promise<Anthropic.Message>((resolve, reject) => {
            const aborted = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (options?.signal?.aborted === true) {
              aborted();
              return;
            }
            const delay = delayOf(params);
            // A script error surfaces as the model call failing, never as an uncaught throw in a timer.
            const answer = (): void => {
              try {
                resolve(reply(params));
              } catch (cause) {
                reject(cause instanceof Error ? cause : new Error(String(cause)));
              }
            };
            if (delay <= 0) {
              answer();
              return;
            }
            const timer = setTimeout(() => {
              options?.signal?.removeEventListener('abort', onAbort);
              answer();
            }, delay);
            const onAbort = (): void => {
              clearTimeout(timer);
              aborted();
            };
            options?.signal?.addEventListener('abort', onAbort, { once: true });
          }),
      }),
    },
  } as unknown as Anthropic;
}

/** The content of the most recent tool_result the conversation holds, or empty. */
function lastToolResult(messages: readonly { role: string; content: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    const block = [...(content as readonly { type?: unknown; content?: unknown }[])].reverse().find((b) => b.type === 'tool_result');
    if (block !== undefined) return typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
  }
  return '';
}

const RESULT_PATH = /^\{\{lastResult:([\w.]+)\}\}$/;

/** Replaces each `{{lastResult:path}}` string in a tool input with that value from the last tool result. */
function withResultValues(input: Record<string, unknown>, messages: readonly { role: string; content: unknown }[]): Record<string, unknown> {
  const resolveValue = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const m = RESULT_PATH.exec(v);
      if (m === null) return v;
      const path = m[1] ?? '';
      let at: unknown;
      try {
        at = JSON.parse(lastToolResult(messages));
      } catch {
        at = undefined;
      }
      for (const key of path.split('.')) at = at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined;
      // An id the script expected and did not get is a broken script, not an empty id to send.
      if (at === undefined) throw new Error(`The scripted step needs ${path} from the last tool result, which has no such value`);
      return at;
    }
    if (Array.isArray(v)) return v.map(resolveValue);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x)]));
    return v;
  };
  return resolveValue(input) as Record<string, unknown>;
}

