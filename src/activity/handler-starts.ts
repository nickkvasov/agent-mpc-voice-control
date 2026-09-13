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
 * sides see: tool name and arguments, `commandId` included. Two starts with
 * identical keys are interchangeable — same tool, same input, same command —
 * so a multiset is exact, not a heuristic.
 */
export class HandlerStarts {
  readonly #counts = new Map<string, number>();

  begin(tool: string, args: unknown): void {
    const key = keyOf(tool, args);
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }

  /** True, and consumed, when a handler started for this call. */
  consume(tool: string, args: unknown): boolean {
    const key = keyOf(tool, args);
    const n = this.#counts.get(key) ?? 0;
    if (n === 0) return false;
    if (n === 1) this.#counts.delete(key);
    else this.#counts.set(key, n - 1);
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
