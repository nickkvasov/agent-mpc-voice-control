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
  /**
   * Whether prior usage for today has been established. A fresh process has NOT
   * established it: reporting a confident 100 remaining after a restart that
   * followed an exhausted day is exactly the confident-wrong-answer Constitution
   * IV forbids. Until restored, the balance is reported as unknown.
   */
  #established = false;
  #resetsAt: number;

  constructor(now: number = Date.now()) {
    this.#resetsAt = nextMidnightPacific(now);
  }

  snapshot(now: number = Date.now()): QuotaSnapshot {
    this.#rollover(now);
    return {
      searchCallsRemaining: this.#established ? DAILY_SEARCH_CALLS - this.#spent : null,
      resetsAt: this.#resetsAt,
    };
  }

  /** Restores persisted usage for today, making the balance known. */
  restore(spent: number, now: number = Date.now()): void {
    this.#rollover(now);
    this.#spent = spent;
    this.#established = true;
  }

  spent(): number {
    return this.#spent;
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
      // A rollover establishes the balance: the new day provably starts at zero.
      this.#established = true;
      this.#resetsAt = nextMidnightPacific(now);
    }
  }
}

/**
 * YouTube quota resets at midnight Pacific.
 *
 * Computed in America/Los_Angeles rather than assuming a permanent UTC-8. Found
 * at Gate C: a fixed 08:00 UTC reset is correct only during standard time, so
 * through daylight time an exhausted deployment kept refusing searches for an
 * hour after the real reset.
 */
function nextMidnightPacific(now: number): number {
  const ZONE = 'America/Los_Angeles';
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = (t: number): Record<string, number> =>
    Object.fromEntries(fmt.formatToParts(t).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));

  const p = parts(now);
  // Seconds elapsed since local midnight, then step forward to the next one.
  const sinceMidnight = ((p['hour'] ?? 0) % 24) * 3600 + (p['minute'] ?? 0) * 60 + (p['second'] ?? 0);
  let candidate = now + (86_400 - sinceMidnight) * 1000;
  // A DST shift moves local midnight by an hour; correct by measuring again.
  const q = parts(candidate);
  const drift = ((q['hour'] ?? 0) % 24) * 3600 + (q['minute'] ?? 0) * 60 + (q['second'] ?? 0);
  if (drift !== 0) candidate -= drift * 1000;
  return candidate;
}
