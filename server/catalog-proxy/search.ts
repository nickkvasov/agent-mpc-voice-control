import { SearchBudget, type BudgetSnapshot } from './budget.ts';

/**
 * GET /api/catalog/search — proxies search.list, holding the key and the cache.
 *
 * The cache is not an optimisation here, it is what makes the feature usable:
 * with 100 searches per day shared across the whole deployment, a conversational
 * interface that re-searches on every reformulation exhausts a day in one
 * sitting (research.md R2).
 */
export interface SearchResultItem {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly publishedAt: number;
  /** Absent when the duration lookup did not establish it — never zero. */
  readonly durationSeconds?: number;
}

/**
 * Upstream says the quota is spent. That is authoritative over the local
 * counter, which cannot see usage from before this process started.
 */
export class UpstreamQuotaExhausted extends Error {
  /**
   * `true` only when upstream said the DAY is spent. A throttle
   * (rateLimitExceeded) clears in seconds and must not latch searches shut
   * until midnight — it proves nothing about the daily allocation.
   */
  readonly daily: boolean;

  // Declared and assigned separately: a parameter property is not erasable, and
  // the backend runs under Node's type stripping (server/tsconfig.json enforces it).
  constructor(message: string, daily: boolean) {
    super(message);
    this.daily = daily;
  }
}

export interface SearchCriteria {
  readonly query: string;
  readonly publishedAfter?: number;
  readonly publishedBefore?: number;
}

export type SearchOutcome =
  | { readonly ok: true; readonly results: readonly SearchResultItem[]; readonly criteriaApplied: SearchCriteria; readonly fromCache: boolean; readonly quota: BudgetSnapshot }
  | { readonly ok: false; readonly reason: 'quota_exhausted'; readonly detail: string; readonly quota: BudgetSnapshot };

export type SearchFetcher = (criteria: SearchCriteria) => Promise<readonly SearchResultItem[]>;

/** Fills durations not yet established; throws when the lookup itself fails. */
export type DurationFiller = (items: readonly SearchResultItem[]) => Promise<readonly SearchResultItem[]>;

export class CatalogSearch {
  readonly #budget: SearchBudget;
  readonly #fetch: SearchFetcher;
  readonly #cache = new Map<string, readonly SearchResultItem[]>();
  /**
   * In-flight fetches, keyed the same way. Found at Gate C: without this, five
   * simultaneous identical searches spend five of the day's hundred calls and
   * issue five upstream requests. Removed on failure so an error is not cached.
   */
  readonly #inFlight = new Map<string, Promise<readonly SearchResultItem[]>>();

  readonly #fill: DurationFiller | undefined;
  /** One refill per key; settles after its result is merged into the cache. */
  readonly #filling = new Map<string, Promise<void>>();
  readonly #refillWaitMs: number;

  /**
   * `refillWaitMs` bounds how long a cached search waits for a duration refill.
   * The page serialises commands, so an unbounded wait here stalls "pause"
   * behind a slow metadata lookup (Gate C).
   */
  constructor(
    fetcher: SearchFetcher,
    budget: SearchBudget = new SearchBudget(),
    fill?: DurationFiller,
    options: { readonly refillWaitMs?: number } = {},
  ) {
    this.#fetch = fetcher;
    this.#budget = budget;
    this.#fill = fill;
    this.#refillWaitMs = options.refillWaitMs ?? 800;
  }

  async search(criteria: SearchCriteria): Promise<SearchOutcome> {
    const key = cacheKey(criteria);
    // Only a cache HIT may await before the in-flight check below. An await on
    // the miss path yields, and an identical search completing in that gap
    // would be missed by both the cache read and the in-flight read — spending
    // the shared allowance twice (Gate C).
    const cached = this.#cache.has(key) ? await this.#refill(key) : undefined;
    if (cached !== undefined) {
      // A cache hit spends no quota, and says so: the page must be able to tell
      // a fresh answer from a remembered one rather than present both as current.
      return { ok: true, results: cached, criteriaApplied: criteria, fromCache: true, quota: this.#budget.snapshot() };
    }
    const pending = this.#inFlight.get(key);
    if (pending !== undefined) {
      try {
        const results = await pending;
        // Through the same bounded duration step as the caller that fetched,
        // or two identical searches answer with different metadata (Gate C).
        const filled = (await this.#refill(key)) ?? results;
        return { ok: true, results: filled, criteriaApplied: criteria, fromCache: true, quota: this.#budget.snapshot() };
      } catch (cause) {
        if (!(cause instanceof UpstreamQuotaExhausted)) throw cause;
        return { ok: false, reason: 'quota_exhausted', detail: cause.message, quota: this.#budget.snapshot() };
      }
    }
    // The budget is checked BEFORE any upstream call: choosing this tool does
    // not by itself authorise spending (NOTES.md 2026-09-12).
    const decision = this.#budget.request();
    if (!decision.allowed) {
      return { ok: false, reason: 'quota_exhausted', detail: decision.detail, quota: this.#budget.snapshot() };
    }
    // The quota day this spend belongs to. A refusal that lands after midnight
    // is about the day that ended, not the one that just began.
    const quotaDay = this.#budget.snapshot().resetsAt;
    const call = this.#fetch(criteria);
    this.#inFlight.set(key, call);
    try {
      const results = await call;
      this.#cache.set(key, results);
      this.#inFlight.delete(key);
      // Durations come from a separate lookup, bounded the same way as on a
      // cache hit: a stalled videos.list must not hold results already paid for.
      const filled = (await this.#refill(key)) ?? results;
      return { ok: true, results: filled, criteriaApplied: criteria, fromCache: false, quota: this.#budget.snapshot() };
    } catch (cause) {
      if (!(cause instanceof UpstreamQuotaExhausted)) throw cause;
      if (cause.daily) this.#budget.markExhausted(quotaDay);
      return { ok: false, reason: 'quota_exhausted', detail: cause.message, quota: this.#budget.snapshot() };
    } finally {
      this.#inFlight.delete(key);
    }
  }

  /**
   * Establishes durations the search did not carry — right after a fresh
   * fetch, and again on a later hit if that failed (1 unit, no search quota),
   * so one failed lookup is not permanent.
   *
   * Coalesced per key, and merged into whatever is cached when it lands rather
   * than written from a snapshot: two overlapping fills otherwise let the later,
   * emptier answer erase a duration the earlier one established (Gate C).
   */
  async #refill(key: string): Promise<readonly SearchResultItem[] | undefined> {
    const cached = this.#cache.get(key);
    const fill = this.#fill;
    if (cached === undefined || fill === undefined || !cached.some((i) => i.durationSeconds === undefined)) {
      return cached;
    }
    let pending = this.#filling.get(key);
    if (pending === undefined) {
      const started = fill(cached)
        .then((filled) => {
          // Merged into whatever is cached when it lands, never written from
          // the snapshot it started with.
          const durations = new Map(filled.map((i) => [i.videoId, i.durationSeconds] as const));
          const latest = this.#cache.get(key) ?? cached;
          this.#cache.set(key, latest.map((i) => {
            const d = durations.get(i.videoId);
            return i.durationSeconds !== undefined || d === undefined ? i : { ...i, durationSeconds: d };
          }));
        })
        .catch(() => {
          // Still unestablished — served as it is, durations unknown.
        })
        .finally(() => {
          if (this.#filling.get(key) === started) this.#filling.delete(key);
        });
      pending = started;
      this.#filling.set(key, pending);
    }
    // Wait briefly, then serve what is known. A refill still running keeps
    // going and lands in the cache for the next hit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pending,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, this.#refillWaitMs); }),
    ]);
    clearTimeout(timer);
    return this.#cache.get(key) ?? cached;
  }

  quota(): BudgetSnapshot {
    return this.#budget.snapshot();
  }
}

function cacheKey(c: SearchCriteria): string {
  return JSON.stringify([c.query.trim().toLowerCase(), c.publishedAfter ?? null, c.publishedBefore ?? null]);
}
