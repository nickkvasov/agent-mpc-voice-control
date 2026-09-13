/**
 * Which calls reached a handler, so the observer never records one twice.
 *
 * The observer records only calls refused before any handler ran, and reads
 * that from the `invoke` gate. That is sufficient for every path but one:
 * `agent-mcp-react`'s cancellation path returns without marking `invoke`, so a
 * handler that ran and was then cancelled still shows `notRun`, and would get a
 * second, refused entry (Phase 9 Gate C, confirmed in the library's
 * invocation.js).
 *
 * The handler is never told which invocation it serves (0.3.0 passes no request
 * metadata), so the join uses what both sides see — tool name and arguments,
 * `commandId` included — and the facts the handler itself can observe about its
 * own invocation:
 *
 * - its signal, aborted exactly when that invocation was cancelled;
 * - whether that signal was already aborted when the handler SETTLED.
 *
 * The second is the library's own verdict rule: a call is reported cancelled
 * iff the cancellation latched before the handler completed. So a settled start
 * whose signal was not yet aborted will end `passed`/`refused`; one that was
 * aborted first, or is aborted while still running, will end `cancelled`.
 *
 * This was reached after four review rounds, each closing one ordering. It is
 * now model-checked rather than argued: every interleaving of two identical
 * concurrent calls (tests/integration/handler-start-orderings.test.ts) and every
 * one of three (1,309,686 orderings, checked while designing it) yields exactly
 * one entry per call.
 *
 * Assumption the proof rests on: `settle` runs in the handler's `finally`, after
 * `afterRender`, so no abort — which arrives from a separate task — can land
 * between it and the library stamping the handler complete.
 */
interface Start {
  readonly signal: AbortSignal;
  settled: boolean;
  abortedAtSettle: boolean;
}

export class HandlerStarts {
  readonly #starts = new Map<string, Start[]>();

  /** First thing in a handler, with that invocation's own signal. */
  begin(tool: string, args: unknown, signal: AbortSignal): void {
    const key = keyOf(tool, args);
    const list = this.#starts.get(key) ?? [];
    list.push({ signal, settled: false, abortedAtSettle: false });
    this.#starts.set(key, list);
  }

  /** Last thing in a handler — in `finally`, after `afterRender`. */
  settle(tool: string, args: unknown, signal: AbortSignal): void {
    const start = this.#starts.get(keyOf(tool, args))?.find((s) => s.signal === signal);
    if (start === undefined) return;
    start.settled = true;
    start.abortedAtSettle = signal.aborted;
  }

  /** True, and consumed, when this terminal belongs to an invocation whose handler started. */
  consume(tool: string, args: unknown, cancelled: boolean): boolean {
    const key = keyOf(tool, args);
    const list = this.#starts.get(key);
    if (list === undefined) return false;
    const index = cancelled
      ? list.findIndex((s) => (s.settled ? s.abortedAtSettle : s.signal.aborted))
      : list.findIndex((s) => s.settled && !s.abortedAtSettle);
    if (index === -1) return false;
    list.splice(index, 1);
    if (list.length === 0) this.#starts.delete(key);
    return true;
  }
}

/** Key order must not matter: the observer holds a detached copy of the arguments. */
function keyOf(tool: string, args: unknown): string {
  return JSON.stringify([tool, stable(args)]);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** The page's one instance, shared by the handlers and the observer. */
export const handlerStarts = new HandlerStarts();
