import Anthropic from '@anthropic-ai/sdk';
import { buildToolNameMap } from './tool-names.ts';

/**
 * The agent host.
 *
 * Runs server-side so the browser never holds a key. The page's only contact
 * with the agent is the socket it opens with a ticket from /api/mcp-ticket.
 *
 * Streaming is not a nicety: the agent's progress is what the person watches
 * during SC-012's three-second window.
 */
export const AGENT_MODEL = 'claude-opus-5';

/**
 * The page's tool surface, as the loop sees it. Deliberately an interface: the
 * loop must be drivable without a socket so its iteration can be tested, and
 * the transport that carries these calls to the browser is a separate concern.
 */
export interface ToolTransport {
  /** Tools the page declares RIGHT NOW. They exist only while their UI is on screen. */
  listTools(): Promise<readonly ToolDescriptor[]>;
  /** The signal aborts the call on the page too: MCP cancellation reaches its handler. */
  callTool(name: string, input: unknown, signal?: AbortSignal): Promise<ToolCallOutcome>;
}

/** What a turn reports as it happens (contracts/backend-http.md, R9). */
export type TurnEvent =
  | { readonly type: 'tool_call'; readonly toolName: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolName: string; readonly outcome: ToolCallOutcome }
  | { readonly type: 'message'; readonly text: string };

export interface TurnOptions {
  /** Cancels the turn: the model stream and any tool call in flight (FR-004). */
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: TurnEvent) => void;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export type ToolCallOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export interface AgentHostConfig {
  readonly apiKey: string;
  /** Kept injectable so tests can drive the loop without a network. */
  readonly client?: Anthropic;
}

export function createClient(config: AgentHostConfig): Anthropic {
  if (config.client !== undefined) return config.client;
  if (config.apiKey.trim() === '') {
    // An unkeyed client would fail at the first call, far from the cause, and
    // the page would show "assistant unavailable" with no actionable reason.
    throw new Error('ANTHROPIC_API_KEY is empty; the agent host cannot start');
  }
  return new Anthropic({ apiKey: config.apiKey });
}

export const SYSTEM_PROMPT = [
  'You drive a YouTube video application by calling the tools it declares.',
  'The application owns its state; you never hold a copy of it.',
  'Call a tool rather than describing what the person should click.',
  'A tool that returns ok:false has refused. Report the stated reason; never retry it as though it had not refused, and never substitute a different action for the one asked for.',
  'Tools exist only while the part of the interface that declares them is on screen. If the tool you need is absent, say so and name what the person would need to open.',
].join(' ');

export interface AgentTurnResult {
  readonly text: string;
  readonly toolCalls: readonly { readonly name: string; readonly outcome: ToolCallOutcome }[];
  readonly stopReason: string | null;
}

const MAX_ITERATIONS = 8;

/**
 * One conversational turn: call the model, run whatever tools it asks for, feed
 * the results back, and repeat until it stops asking.
 *
 * Bounded deliberately. An unbounded loop against a model that keeps calling
 * tools is a runaway spend and a page being driven with nobody watching; hitting
 * the bound is reported rather than hidden.
 */
export async function runAgentTurn(
  client: Anthropic,
  transport: ToolTransport,
  commandText: string,
  options: TurnOptions = {},
): Promise<AgentTurnResult> {
  const { signal, onEvent } = options;
  try {
    return await runTurn(client, transport, commandText, signal, onEvent);
  } catch (cause) {
    // A cancelled turn is an outcome, named — not an error thrown past the caller.
    if (signal?.aborted === true) return { text: '', toolCalls: [], stopReason: 'cancelled' };
    throw cause;
  }
}

async function runTurn(
  client: Anthropic,
  transport: ToolTransport,
  commandText: string,
  signal: AbortSignal | undefined,
  onEvent: TurnOptions['onEvent'],
): Promise<AgentTurnResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: commandText }];
  const toolCalls: { name: string; outcome: ToolCallOutcome }[] = [];
  let text = '';
  /**
   * The last non-empty declaration. Kept because a transcript containing
   * tool_use/tool_result blocks may not be sent with an empty `tools` array —
   * the API rejects that with a 400 — and the view owning the tools can unmount
   * mid-turn. Retaining the schemas lets the model finish its sentence about
   * what it already did; `tool_choice: none` stops it calling anything that is
   * no longer on screen.
   */
  let lastTools: Anthropic.Tool[] = [];
  /**
   * Every API alias this turn has shown the model, back to its application
   * name. A tool can leave the listing mid-turn — its view closed — while the
   * model still calls it from an earlier step. Resolved through only the current
   * listing, the page was sent `catalog__resolveReference`, a name it never had,
   * and could not say which view to open (T136, FR-035).
   */
  const namesThisTurn = new Map<string, string>();

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    // Asked every iteration, not once per turn: tools exist only while the UI
    // declaring them is on screen, so a view changing mid-turn must reach the
    // model (FR-035). Cheap since Phase 11 — the page connection serves a cached
    // listing and drops it when the page announces `tools/list_changed` (R6),
    // so this is a socket round trip only when the tools actually changed.
    const declared = await transport.listTools();
    const names = buildToolNameMap(declared.map((t) => t.name));
    for (const [alias, name] of names.fromApi) namesThisTurn.set(alias, name);
    const fresh: Anthropic.Tool[] = declared.map((t) => ({
      name: names.toApi.get(t.name) ?? t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // Every tool went away mid-turn. Finalise with the previous schemas rather
    // than sending an empty list the API refuses, and forbid further calls.
    const toolsVanished = fresh.length === 0 && lastTools.length > 0;
    const tools = toolsVanished ? lastTools : fresh;
    if (fresh.length > 0) lastTools = fresh;

    if (signal?.aborted === true) return { text, toolCalls, stopReason: 'cancelled' };
    const stream = client.messages.stream({
      model: AGENT_MODEL,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: toolsVanished
        ? `${SYSTEM_PROMPT} The view declaring these tools has just closed, so none of them can be called now. Say what you did and what is no longer available.`
        : SYSTEM_PROMPT,
      tools,
      ...(toolsVanished ? { tool_choice: { type: 'none' as const } } : {}),
      messages,
    }, signal === undefined ? undefined : { signal });
    const response = await stream.finalMessage();

    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (text !== '') onEvent?.({ type: 'message', text });
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) return { text, toolCalls, stopReason: response.stop_reason };

    messages.push({ role: 'assistant', content: response.content });

    // Parallel tool results must go back in ONE user message; splitting them
    // trains the model to stop making parallel calls.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      // Back to the application's own name before it reaches the page.
      const appName = namesThisTurn.get(use.name) ?? use.name;
      onEvent?.({ type: 'tool_call', toolName: appName, input: use.input });
      const outcome = await transport.callTool(appName, use.input, signal);
      toolCalls.push({ name: appName, outcome });
      onEvent?.({ type: 'tool_result', toolName: appName, outcome });
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(outcome),
        // A refusal is surfaced as an error so the model cannot read it as success.
        is_error: !outcome.ok,
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    text,
    toolCalls,
    // Named, not silently truncated: the caller must be able to tell a finished
    // turn from one that hit the bound (IMMUNE-U).
    stopReason: 'iteration_limit',
  };
}
