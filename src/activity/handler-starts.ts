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
   * A COMPLETED terminal (`invoke` passed or refused) always came from a handler
   * that ran, so it retires a start whatever that start's signal now says — a
   * cancellation landing after the handler settled leaves `invoke: passed` with
   * an aborted signal (Gate C round 3).
   *
   * A CANCELLED terminal matches only an aborted start: a running identical
   * call's signal is live, so it is never mistaken for the cancelled one (round 2).
   *
   * Which of several identical starts is consumed is deliberately unspecified:
   * they are interchangeable, and a preference was tried and proved to change
   * no entry count in any ordering — a rule no test can observe is not kept.
   *
   * **Known limit, stated rather than hidden.** The handler is never told which
   * invocation it serves (`agent-mcp-react` 0.3.0 passes no request metadata),
   * so one ordering stays indistinguishable: identical call A's handler
   * finishes and A is aborted late with its terminal still in flight, while
   * identical call B is cancelled before its handler and B's terminal is
   * observed first. B consumes A's start and goes unrecorded. It needs two
   * concurrent calls with the same tool, arguments and command, plus a
   * cancellation between one handler settling and its terminal. The fix is the
   * library passing request `_meta` to handlers (research R7).
   */
  consume(tool: string, args: unknown, cancelled: boolean): boolean {
    const key = keyOf(tool, args);
    const list = this.#starts.get(key);
    if (list === undefined) return false;
    const index = cancelled ? list.findIndex((signal) => signal.aborted) : 0;
    if (index === -1 || list.length === 0) return false;
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
