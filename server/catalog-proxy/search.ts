import { SearchQuota, type QuotaSnapshot } from './quota.ts';

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
}

export interface SearchCriteria {
  readonly query: string;
  readonly publishedAfter?: number;
  readonly publishedBefore?: number;
}

export type SearchOutcome =
  | { readonly ok: true; readonly results: readonly SearchResultItem[]; readonly criteriaApplied: SearchCriteria; readonly fromCache: boolean; readonly quota: QuotaSnapshot }
  | { readonly ok: false; readonly reason: 'quota_exhausted'; readonly quota: QuotaSnapshot };

export type SearchFetcher = (criteria: SearchCriteria) => Promise<readonly SearchResultItem[]>;

export class CatalogSearch {
  readonly #quota: SearchQuota;
  readonly #fetch: SearchFetcher;
  readonly #cache = new Map<string, readonly SearchResultItem[]>();

  constructor(fetcher: SearchFetcher, quota: SearchQuota = new SearchQuota()) {
    this.#fetch = fetcher;
    this.#quota = quota;
  }

  async search(criteria: SearchCriteria): Promise<SearchOutcome> {
    const key = cacheKey(criteria);
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      // A cache hit spends no quota, and says so: the page must be able to tell
      // a fresh answer from a remembered one rather than present both as current.
      return { ok: true, results: cached, criteriaApplied: criteria, fromCache: true, quota: this.#quota.snapshot() };
    }
    if (!this.#quota.trySpend()) {
      return { ok: false, reason: 'quota_exhausted', quota: this.#quota.snapshot() };
    }
    const results = await this.#fetch(criteria);
    this.#cache.set(key, results);
    return { ok: true, results, criteriaApplied: criteria, fromCache: false, quota: this.#quota.snapshot() };
  }

  quota(): QuotaSnapshot {
    return this.#quota.snapshot();
  }
}

function cacheKey(c: SearchCriteria): string {
  return JSON.stringify([c.query.trim().toLowerCase(), c.publishedAfter ?? null, c.publishedBefore ?? null]);
}
