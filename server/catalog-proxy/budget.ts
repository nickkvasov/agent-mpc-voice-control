/**
 * The spending gate for catalog searches.
 *
 * A daily counter prevents EXCEEDING the 100-call quota; it does not prevent
 * EXHAUSTING it, and exhaustion is the likely failure — one enthusiastic
 * sitting empties the day for everyone, because the deployment is anonymous and
 * the allowance is shared. Codex's point at the Gate C consult, and the reason
 * this is a replenishing budget rather than a counter (NOTES.md 2026-09-12).
 *
 * Burst 2 so a person can refine twice immediately; one allowance back every
 * 16 minutes; a working cap of 90 with 10 held in reserve so an operator still
 * has room after ordinary traffic has taken all it may.
 */
export const DAILY_HARD_LIMIT = 100;
export const DAILY_WORKING_CAP = 90;
export const BURST = 2;
export const REPLENISH_MS = 16 * 60 * 1000;

export type BudgetDecision =
  | { readonly allowed: true; readonly remainingToday: number }
  | { readonly allowed: false; readonly reason: 'daily_cap' | 'rate'; readonly retryAfterMs: number; readonly detail: string };

export interface BudgetSnapshot {
  /** `null` until prior usage for today is established (Constitution IV). */
  readonly searchCallsRemaining: number | null;
  readonly tokensAvailable: number;
  readonly resetsAt: number;
}

export class SearchBudget {
  #spentToday = 0;
  #established = false;
  #tokens = BURST;
  #lastReplenish: number;
  #resetsAt: number;

  constructor(now: number = Date.now()) {
    this.#lastReplenish = now;
    this.#resetsAt = nextMidnightPacific(now);
  }

  restore(spentToday: number, now: number = Date.now()): void {
    this.#rollover(now);
    this.#spentToday = spentToday;
    this.#established = true;
  }

  snapshot(now: number = Date.now()): BudgetSnapshot {
    this.#rollover(now);
    this.#replenish(now);
    return {
      searchCallsRemaining: this.#established ? Math.max(0, DAILY_WORKING_CAP - this.#spentToday) : null,
      tokensAvailable: Math.floor(this.#tokens),
      resetsAt: this.#resetsAt,
    };
  }

  /** Checked BEFORE any upstream call. Spending is never implied by tool choice. */
  request(now: number = Date.now()): BudgetDecision {
    this.#rollover(now);
    this.#replenish(now);
    if (this.#spentToday >= DAILY_WORKING_CAP) {
      return {
        allowed: false,
        reason: 'daily_cap',
        retryAfterMs: Math.max(0, this.#resetsAt - now),
        detail: `Today's search allowance is spent (${String(DAILY_WORKING_CAP)} of ${String(DAILY_HARD_LIMIT)} used; the rest is held in reserve). Filtering what is already loaded still works.`,
      };
    }
    if (this.#tokens < 1) {
      const wait = Math.max(0, REPLENISH_MS - (now - this.#lastReplenish));
      return {
        allowed: false,
        reason: 'rate',
        retryAfterMs: wait,
        detail: `Searches are paced so one sitting cannot use up the day's shared allowance. The next one is available in about ${String(Math.ceil(wait / 60000))} minutes. Filtering what is already loaded still works.`,
      };
    }
    this.#tokens -= 1;
    this.#spentToday += 1;
    return { allowed: true, remainingToday: Math.max(0, DAILY_WORKING_CAP - this.#spentToday) };
  }

  /**
   * Upstream refused for quota: nothing more is spent until the day rolls over.
   *
   * `quotaDay` is the `resetsAt` in force when the request was made. If the day
   * has turned since, the refusal describes a day that is over and is ignored —
   * otherwise a response delayed across midnight shuts the new day too.
   */
  markExhausted(quotaDay: number, now: number = Date.now()): void {
    this.#rollover(now);
    if (quotaDay !== this.#resetsAt) return;
    this.#spentToday = Math.max(this.#spentToday, DAILY_WORKING_CAP);
    this.#established = true;
  }

  spentToday(): number {
    return this.#spentToday;
  }

  #replenish(now: number): void {
    const elapsed = now - this.#lastReplenish;
    if (elapsed < REPLENISH_MS) return;
    const earned = Math.floor(elapsed / REPLENISH_MS);
    this.#tokens = Math.min(BURST, this.#tokens + earned);
    this.#lastReplenish += earned * REPLENISH_MS;
  }

  #rollover(now: number): void {
    if (now < this.#resetsAt) return;
    this.#spentToday = 0;
    this.#established = true;
    this.#tokens = BURST;
    this.#lastReplenish = now;
    this.#resetsAt = nextMidnightPacific(now);
  }
}

/** Midnight in America/Los_Angeles, computed rather than assuming UTC-8. */
function nextMidnightPacific(now: number): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = (t: number): Record<string, number> =>
    Object.fromEntries(fmt.formatToParts(t).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const p = parts(now);
  const since = ((p['hour'] ?? 0) % 24) * 3600 + (p['minute'] ?? 0) * 60 + (p['second'] ?? 0);
  let candidate = now + (86_400 - since) * 1000;
  const q = parts(candidate);
  const drift = ((q['hour'] ?? 0) % 24) * 3600 + (q['minute'] ?? 0) * 60 + (q['second'] ?? 0);
  if (drift !== 0) candidate -= drift * 1000;
  return candidate;
}
