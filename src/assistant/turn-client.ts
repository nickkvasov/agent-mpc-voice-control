/**
 * The page's side of one assistant turn (T132, research R9).
 *
 * The acknowledgement is rendered HERE, before any network call — that is how
 * SC-001's and SC-012's one-second acknowledgement is met whatever the model
 * does. The turn then follows the server's event stream; after ten seconds
 * without a result it is marked late (SC-012) and stays cancellable; cancelling
 * revokes the command locally BEFORE aborting the request, so a tool call that
 * races the cancellation finds the command already revoked (research R7).
 */
export const LATE_AFTER_MS = 10_000;
export const TURNS_URL = '/api/assistant/turns';

export type TurnState = 'acknowledged' | 'running' | 'late' | 'done' | 'refused' | 'cancelled';

export interface TurnRefusal {
  readonly reason: string;
  readonly detail: string;
  readonly limit?: 'session' | 'day';
  readonly resetsAt?: number;
}

export interface TurnView {
  readonly commandId: string;
  readonly text: string;
  readonly state: TurnState;
  readonly acknowledgedAt: number;
  readonly lateAt: number | null;
  readonly toolCalls: readonly { readonly toolName: string; readonly ok?: boolean; readonly reason?: string; readonly detail?: string }[];
  readonly messages: readonly string[];
  readonly refusal: TurnRefusal | null;
  readonly stopReason: string | null;
}

export interface TurnClientOptions {
  readonly revoke: () => void;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => () => void;
}

const TERMINAL: readonly TurnState[] = ['done', 'refused', 'cancelled'];

export function startTurn(
  request: { readonly commandId: string; readonly tabId: string; readonly text: string },
  onChange: (view: TurnView) => void,
  options: TurnClientOptions,
): { cancel(): void; readonly done: Promise<TurnView> } {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });

  let view: TurnView = {
    commandId: request.commandId, text: request.text, state: 'acknowledged', acknowledgedAt: now(),
    lateAt: null, toolCalls: [], messages: [], refusal: null, stopReason: null,
  };
  let settle!: (v: TurnView) => void;
  const done = new Promise<TurnView>((r) => { settle = r; });
  const update = (change: Partial<TurnView>): void => {
    if (TERMINAL.includes(view.state)) return;
    view = { ...view, ...change };
    onChange(view);
    if (TERMINAL.includes(view.state)) {
      clearLate();
      settle(view);
    }
  };

  // Rendered now, before any network call.
  onChange(view);

  const controller = new AbortController();
  const clearLate = setTimer(() => {
    if (!TERMINAL.includes(view.state)) update({ state: 'late', lateAt: now() });
  }, LATE_AFTER_MS);

  void (async () => {
    let res: Response;
    try {
      res = await fetchImpl(TURNS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      update({ state: 'refused', refusal: { reason: 'assistant_unreachable', detail: `The assistant could not be reached (${String(cause)}).` } });
      return;
    }
    if (res.status !== 200) {
      const body = (await res.json().catch(() => ({}))) as Partial<TurnRefusal>;
      update({
        state: 'refused',
        refusal: {
          reason: typeof body.reason === 'string' ? body.reason : `http_${String(res.status)}`,
          detail: typeof body.detail === 'string' ? body.detail : `The assistant refused the turn (${String(res.status)}).`,
          ...(body.limit === 'session' || body.limit === 'day' ? { limit: body.limit } : {}),
          ...(typeof body.resetsAt === 'number' ? { resetsAt: body.resetsAt } : {}),
        },
      });
      return;
    }
    try {
      await readEvents(res, (event, data) => {
        if (event === 'acknowledged') update({ state: view.state === 'late' ? 'late' : 'running' });
        else if (event === 'tool_call') update({ toolCalls: [...view.toolCalls, { toolName: String(data['toolName']) }] });
        else if (event === 'tool_result') {
          const i = view.toolCalls.map((c) => c.toolName).lastIndexOf(String(data['toolName']));
          const result = {
            toolName: String(data['toolName']),
            ok: data['ok'] === true,
            ...(typeof data['reason'] === 'string' ? { reason: data['reason'] } : {}),
            ...(typeof data['detail'] === 'string' ? { detail: data['detail'] } : {}),
          };
          update({ toolCalls: i === -1 ? [...view.toolCalls, result] : view.toolCalls.map((c, j) => (j === i ? result : c)) });
        } else if (event === 'message') update({ messages: [...view.messages, String(data['text'])] });
        else if (event === 'refused') update({ refusal: { reason: String(data['reason']), detail: String(data['detail']) } });
        else if (event === 'done') {
          const stopReason = String(data['stopReason']);
          if (stopReason === 'iteration_limit') {
            // Stopped, not finished: shown as such, never as "Done." (contract; Gate C).
            update({ state: 'refused', stopReason, refusal: { reason: 'iteration_limit', detail: 'The assistant stopped at its step limit without finishing. What it already did is listed above.' } });
          } else {
            update(view.refusal !== null || stopReason === 'failed'
              ? { state: 'refused', stopReason }
              : stopReason === 'cancelled' ? { state: 'cancelled', stopReason } : { state: 'done', stopReason });
          }
        }
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      update({ state: 'refused', refusal: { reason: 'stream_failed', detail: `The assistant's stream failed (${String(cause)}).` } });
      return;
    }
    // A stream that ends without `done` did not finish; it is never shown as finished.
    update({ state: 'refused', refusal: { reason: 'stream_incomplete', detail: 'The assistant\'s stream ended before the turn finished.' } });
  })();

  return {
    done,
    cancel() {
      if (TERMINAL.includes(view.state)) return;
      options.revoke(); // first: a late call must find the command revoked
      controller.abort();
      update({ state: 'cancelled', stopReason: 'cancelled' });
    },
  };
}

async function readEvents(res: Response, onEvent: (event: string, data: Record<string, unknown>) => void): Promise<void> {
  if (res.body === null) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event !== undefined && data !== undefined) onEvent(event, JSON.parse(data) as Record<string, unknown>);
      split = buffer.indexOf('\n\n');
    }
  }
}

/** Finished turns kept on screen. Unfinished turns are never hidden: each carries its Cancel. */
export const MAX_FINISHED_SHOWN = 5;

/**
 * Every unfinished turn, then the most recent finished ones. Limiting all turns
 * together hid a slow turn behind five newer ones — and its Cancel button with
 * it, leaving work running with no way to stop it (Gate C).
 */
export function visibleTurns(turns: readonly TurnView[]): readonly TurnView[] {
  const unfinished = turns.filter((t) => !TERMINAL.includes(t.state));
  const finished = turns.filter((t) => TERMINAL.includes(t.state)).slice(0, MAX_FINISHED_SHOWN);
  return [...unfinished, ...finished];
}

/**
 * What a turn did, for the command history (data-model Command.outcome).
 *
 * A stream that ended normally is not an action that succeeded: a tool may have
 * refused — a person declining a deletion — while the assistant explained it
 * perfectly. The outcome comes from the tool results (Gate C).
 */
export function commandOutcome(view: TurnView): { readonly outcome: 'applied' | 'partially_applied' | 'refused' | 'cancelled'; readonly reason: string | null } {
  if (view.state === 'cancelled') return { outcome: 'cancelled', reason: 'cancelled' };
  if (view.state !== 'done') return { outcome: 'refused', reason: view.refusal?.reason ?? view.stopReason ?? view.state };
  const applied = view.toolCalls.filter((c) => c.ok === true).length;
  const refused = view.toolCalls.filter((c) => c.ok === false);
  if (refused.length === 0) return { outcome: 'applied', reason: null };
  if (applied === 0) return { outcome: 'refused', reason: refused[0]?.reason ?? 'refused' };
  return { outcome: 'partially_applied', reason: refused[0]?.reason ?? 'refused' };
}

