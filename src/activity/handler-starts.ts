/**
 * Which calls reached a handler, so the observer never records one twice.
 *
 * The observer records only calls refused before any handler ran, and reads
 * that from the `invoke` gate. That is sufficient for every path but one:
 * `agent-mcp-react`'s cancellation path returns without marking `invoke`, so a
 * handler that ran and was then cancelled — during `afterRender`, say — still
 * shows `notRun`, and would get a second, refused entry (Phase 9 Gate C,
 * confirmed in the library's invocation.js).
 *
 * The handler does not see the call's `callId`, so the join is on what both
 * sides see — tool name and arguments, `commandId` included — narrowed by the
 * invocation's own signal, which is aborted exactly when that call was cancelled.
 */
export class HandlerStarts {
  readonly #starts = new Map<string, AbortSignal[]>();

  /** Called first thing in a handler, with that invocation's own signal. */
  begin(tool: string, args: unknown, signal: AbortSignal): void {
    const key = keyOf(tool, args);
    const list = this.#starts.get(key) ?? [];
    list.push(signal);
    this.#starts.set(key, list);
  }

  /**
   * True, and consumed, when this terminal belongs to an invocation whose
   * handler started.
   *
   * Arguments alone could not tell identical concurrent calls apart: a call
   * cancelled before its handler consumed the start of an identical call still
   * running, and went unrecorded (Gate C round 2). The invocation's own signal
   * separates them — a cancelled call's signal is aborted, a running one's is
   * not — so a cancellation matches only an aborted start, and a completed call
   * only a live one. Two identical cancelled starts are indistinguishable, and
   * matching them one each keeps the count exact.
   */
  consume(tool: string, args: unknown, cancelled: boolean): boolean {
    const key = keyOf(tool, args);
    const list = this.#starts.get(key);
    if (list === undefined) return false;
    const index = list.findIndex((signal) => signal.aborted === cancelled);
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
