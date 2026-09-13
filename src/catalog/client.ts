import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { refuse, ok, type ToolResult } from '../mcp/result.ts';
import { makeVideoReference, type VideoReference } from '../store/video-reference.ts';
import type { Criteria } from './results.ts';

/**
 * The page's view of the catalog proxy.
 *
 * The browser never holds the YouTube key and never counts quota — both live
 * behind this endpoint, because the allowance is shared by everyone using the
 * deployment and a per-tab counter could not see that.
 */
export interface QuotaView {
  /** `null` means not established, never a confident zero (Constitution IV). */
  readonly searchCallsRemaining: number | null;
  readonly resetsAt: number | null;
}

export interface SearchResponse {
  readonly items: readonly VideoReference[];
  readonly criteriaApplied: Criteria;
  readonly fromCache: boolean;
  readonly quota: QuotaView;
}

export type Fetcher = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

const defaultFetcher: Fetcher = (url) => fetch(url);

export async function searchCatalog(
  criteria: Criteria,
  fetcher: Fetcher = defaultFetcher,
): Promise<ToolResult<SearchResponse>> {
  const params = new URLSearchParams({ q: criteria.query ?? '' });
  if (criteria.publishedAfter !== undefined) params.set('publishedAfter', String(criteria.publishedAfter));
  if (criteria.publishedBefore !== undefined) params.set('publishedBefore', String(criteria.publishedBefore));

  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await fetcher(`/api/catalog/search?${params.toString()}`);
  } catch (cause) {
    return refuse(
      REFUSAL_REASON.quotaExhausted,
      `The catalog could not be reached (${String(cause)}). Anything already loaded still works.`,
      true,
    );
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (res.status === 429) {
    // A daily condition, not an exception path (FR-022).
    return refuse(
      REFUSAL_REASON.quotaExhausted,
      typeof body['detail'] === 'string'
        ? body['detail']
        : 'The shared search allowance is spent for now. Filtering what is already loaded still works.',
      true,
    );
  }
  if (res.status !== 200) {
    return refuse(
      REFUSAL_REASON.capabilityUnsupported,
      `The catalog refused the request (${String(res.status)}). Anything already loaded still works.`,
    );
  }

  const raw = Array.isArray(body['results']) ? (body['results'] as Record<string, unknown>[]) : [];
  const items: VideoReference[] = [];
  for (const r of raw) {
    try {
      items.push(
        makeVideoReference({
          videoId: String(r['videoId'] ?? ''),
          title: String(r['title'] ?? ''),
          channelTitle: String(r['channelTitle'] ?? ''),
          // Omitted when the backend did not establish it, so the reference
          // stores UNKNOWN. Defaulting to 0 made every live result "0 min".
          ...(typeof r['durationSeconds'] === 'number' ? { durationSeconds: r['durationSeconds'] } : {}),
          publishedAt: Number(r['publishedAt'] ?? 0),
        }),
      );
    } catch {
      // A malformed row is dropped rather than stored speculatively; the count
      // difference is visible because criteriaApplied and the list are both shown.
    }
  }
  const q = (body['quota'] ?? {}) as Record<string, unknown>;
  return ok({
    items,
    criteriaApplied: (body['criteriaApplied'] ?? {}) as Criteria,
    fromCache: body['fromCache'] === true,
    quota: {
      searchCallsRemaining: typeof q['searchCallsRemaining'] === 'number' ? q['searchCallsRemaining'] : null,
      resetsAt: typeof q['resetsAt'] === 'number' ? q['resetsAt'] : null,
    },
  });
}
