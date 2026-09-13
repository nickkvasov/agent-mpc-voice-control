import { UpstreamQuotaExhausted, type DurationFiller, type SearchCriteria, type SearchFetcher, type SearchResultItem } from './search.ts';
import { parseIso8601Duration, UNKNOWN, type VideoDetails } from './videos.ts';

/**
 * The only module that talks to the YouTube Data API. It holds the key and
 * nothing else does, so the key can leak from exactly one place — which is why
 * no error raised here ever carries a URL.
 *
 * Cost: search.list is 100 units (the 100/day ceiling SearchBudget guards);
 * videos.list is 1 unit, so every search is followed by one to fill durations.
 */
export type Http = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * Every upstream call has a deadline. Without one a stalled request holds the
 * page's command chain — and "pause" behind it — until the OS gives up.
 */
export const UPSTREAM_TIMEOUT_MS = 5000;
const timedFetch: Http = (url) => fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_RESULTS = 25;
const DAILY_QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);
const THROTTLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
/** videos.list accepts at most this many ids per call. */
const VIDEOS_PER_CALL = 50;

/**
 * search.list alone. Durations are NOT filled here: CatalogSearch runs the
 * filler with a bounded wait, so a stalled videos.list cannot hold results.
 */
export function youTubeSearchFetcher(key: string, http: Http = timedFetch): SearchFetcher {
  return async (criteria: SearchCriteria): Promise<readonly SearchResultItem[]> => {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: String(MAX_RESULTS),
      q: criteria.query,
      key,
    });
    if (criteria.publishedAfter !== undefined) params.set('publishedAfter', new Date(criteria.publishedAfter).toISOString());
    if (criteria.publishedBefore !== undefined) params.set('publishedBefore', new Date(criteria.publishedBefore).toISOString());

    const body = await call(http, `${API}/search?${params.toString()}`, 'search.list');
    const items = itemsOf(body, 'search.list').flatMap((raw): SearchResultItem[] => {
      const item = asRecord(raw);
      const videoId = asRecord(item['id'])['videoId'];
      const snippet = asRecord(item['snippet']);
      if (typeof videoId !== 'string') return [];
      return [{
        videoId,
        title: decodeEntities(String(snippet['title'] ?? '')),
        channelTitle: decodeEntities(String(snippet['channelTitle'] ?? '')),
        publishedAt: Date.parse(String(snippet['publishedAt'] ?? '')) || 0,
      }];
    });

    return items;
  };
}

/**
 * Fills `durationSeconds` where YouTube returns one. Throws when the lookup
 * fails, so the caller can tell "not established yet" from "established".
 */
export function youTubeDurationFiller(key: string, http: Http = timedFetch): DurationFiller {
  const details = youTubeVideoDetailsFetcher(key, http);
  return async (items) => {
    const missing = items.filter((i) => i.durationSeconds === undefined).map((i) => i.videoId);
    if (missing.length === 0) return items;
    const durations = new Map(
      (await details(missing)).flatMap((d) => (d.durationSeconds === UNKNOWN ? [] : [[d.videoId, d.durationSeconds] as const])),
    );
    return items.map((i) => {
      const d = durations.get(i.videoId);
      return i.durationSeconds !== undefined || d === undefined ? i : { ...i, durationSeconds: d };
    });
  };
}

export function youTubeVideoDetailsFetcher(
  key: string,
  http: Http = timedFetch,
): (ids: readonly string[]) => Promise<readonly VideoDetails[]> {
  return async (ids) => {
    const out: VideoDetails[] = [];
    // Batched, never truncated: a dropped id would be indistinguishable from a
    // video YouTube could not return.
    for (let at = 0; at < ids.length; at += VIDEOS_PER_CALL) {
      const params = new URLSearchParams({ part: 'contentDetails,snippet', id: ids.slice(at, at + VIDEOS_PER_CALL).join(','), key });
      const body = await call(http, `${API}/videos?${params.toString()}`, 'videos.list');
      for (const raw of itemsOf(body, 'videos.list')) {
        const item = asRecord(raw);
        const content = asRecord(item['contentDetails']);
        if (typeof item['id'] !== 'string') continue;
        // Live and upcoming videos report PT0S (or P0D, which does not parse).
        // Neither is a length: stored as zero they would pass "only the short
        // ones" and be cached as established, so they stay UNKNOWN.
        const parsed = parseIso8601Duration(String(content['duration'] ?? ''));
        const duration = parsed === undefined || parsed === 0 ? UNKNOWN : parsed;
        out.push({
          videoId: item['id'],
          durationSeconds: duration,
          // "false" means no UPLOADED caption track. Auto-generated captions are
          // not reported by the API, so only "true" is evidence (Constitution IV).
          hasCaptions: content['caption'] === 'true' ? true : UNKNOWN,
          // A description without a chapter list is not evidence of no chapters:
          // YouTube can generate them automatically.
          chapters: parseChapters(String(asRecord(item['snippet'])['description'] ?? ''), duration === UNKNOWN ? undefined : duration) ?? UNKNOWN,
        });
      }
    }
    return out;
  };
}

/**
 * Chapters as YouTube itself recognises them in a description: the first at
 * 0:00, at least three, ascending, each at least ten seconds long. Anything
 * else is `undefined` — not a chapter list, and not a claim there are none.
 */
export function parseChapters(
  description: string,
  durationSeconds?: number,
): { title: string; startSeconds: number }[] | undefined {
  const chapters: { title: string; startSeconds: number }[] = [];
  for (const line of description.split(/\r?\n/)) {
    // The timestamp must end where it ends: `(?![\d:])` stops "0:30:00" being
    // read as 0:30 titled "00". Seconds are 00–59, and a title is required.
    const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)(?![\d:])\s*(?:[-–—|]\s*)?(\S.*?)\s*$/.exec(line);
    if (m === null) continue;
    const [, h, min, s, title] = m;
    if (h !== undefined && Number(min) > 59) continue;
    chapters.push({ title: title ?? '', startSeconds: Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) });
  }
  if (chapters.length < 3 || chapters[0]?.startSeconds !== 0) return undefined;
  for (let i = 1; i < chapters.length; i += 1) {
    if ((chapters[i]?.startSeconds ?? 0) - (chapters[i - 1]?.startSeconds ?? 0) < 10) return undefined;
  }
  // The last chapter runs to the end of the video, so it must fit inside it
  // with the same ten-second minimum. Unchecked when the length is not known.
  const last = chapters[chapters.length - 1]?.startSeconds ?? 0;
  if (durationSeconds !== undefined && durationSeconds - last < 10) return undefined;
  return chapters;
}

async function call(http: Http, url: string, what: string): Promise<unknown> {
  let res: Awaited<ReturnType<Http>>;
  try {
    res = await http(url);
  } catch (cause) {
    // The cause of a network failure can quote the request URL, key included,
    // so it is deliberately NOT attached — only its class name is kept.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${what} could not reach YouTube (${cause instanceof Error ? cause.name : 'network error'})`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    // A 200 whose body cannot be read is a failed lookup, not an empty answer:
    // turned into `[]` it would be cached as "nothing matched" (IMMUNE-U).
    if (res.status === 200) {
      // eslint-disable-next-line preserve-caught-error -- the parser's message can quote the URL, key included
      throw new Error(`${what} returned an unreadable response (${cause instanceof Error ? cause.name : 'parse error'})`);
    }
    body = {};
  }
  if (res.status === 200) return body;
  const reasons = asArray(asRecord(asRecord(body)['error'])['errors']).map((e) => String(asRecord(e)['reason'] ?? ''));
  if (reasons.some((r) => DAILY_QUOTA_REASONS.has(r))) {
    throw new UpstreamQuotaExhausted(`YouTube reports today's search quota is spent (${reasons.join(', ')}). Filtering what is already loaded still works.`, true);
  }
  if (reasons.some((r) => THROTTLE_REASONS.has(r))) {
    throw new UpstreamQuotaExhausted(`YouTube is throttling searches for a moment (${reasons.join(', ')}). Try again shortly; filtering what is already loaded still works.`, false);
  }
  // Only the status and machine reasons: YouTube's message text can echo the key.
  throw new Error(`${what} failed with ${String(res.status)} (${reasons.join(', ') || 'no reason given'})`);
}

/**
 * A 200 without an `items` array is a malformed answer, not an empty one —
 * coerced to `[]` it would be cached as "nothing matched" (Constitution IV).
 */
function itemsOf(body: unknown, what: string): readonly unknown[] {
  const items = asRecord(body)['items'];
  if (!Array.isArray(items)) throw new Error(`${what} returned a response without an items list`);
  return items;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}
