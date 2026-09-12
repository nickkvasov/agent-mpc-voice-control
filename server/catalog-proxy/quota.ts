/**
 * YouTube search quota accounting.
 *
 * Measured, not assumed: `search.list` is capped at 100 calls per DAY per
 * project, separate from the 10,000-unit pool other endpoints share. Because
 * this feature is anonymous, that ceiling is shared by everyone using the
 * deployment — 100 searches total, not 100 each (research.md R2).
 */
export const DAILY_SEARCH_CALLS = 100;

export interface QuotaSnapshot {
  /** `null` means not established — never reported as a confident zero. */
  readonly searchCallsRemaining: number | null;
  readonly resetsAt: number | null;
}

export class SearchQuota {
  #spent = 0;
  #resetsAt: number;

  constructor(now: number = Date.now()) {
    this.#resetsAt = nextMidnightPacific(now);
  }

  snapshot(now: number = Date.now()): QuotaSnapshot {
    this.#rollover(now);
    return { searchCallsRemaining: DAILY_SEARCH_CALLS - this.#spent, resetsAt: this.#resetsAt };
  }

  /** Returns false when the call must not be made. */
  trySpend(now: number = Date.now()): boolean {
    this.#rollover(now);
    if (this.#spent >= DAILY_SEARCH_CALLS) return false;
    this.#spent += 1;
    return true;
  }

  #rollover(now: number): void {
    if (now >= this.#resetsAt) {
      this.#spent = 0;
      this.#resetsAt = nextMidnightPacific(now);
    }
  }
}

/** YouTube quota resets at midnight Pacific. */
function nextMidnightPacific(now: number): number {
  const d = new Date(now);
  const utcMidnightAfterPacific = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8, 0, 0, 0);
  return utcMidnightAfterPacific > now ? utcMidnightAfterPacific : utcMidnightAfterPacific + 86_400_000;
}
