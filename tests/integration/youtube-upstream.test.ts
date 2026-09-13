import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseChapters,
  youTubeSearchFetcher,
  youTubeVideoDetailsFetcher,
  youTubeDurationFiller,
  type Http,
} from '../../server/catalog-proxy/youtube.ts';
import { CatalogSearch, UpstreamQuotaExhausted } from '../../server/catalog-proxy/search.ts';
import { SearchBudget, DAILY_WORKING_CAP } from '../../server/catalog-proxy/budget.ts';

const KEY = 'AIza-TEST-KEY-must-never-leak';

/** Records every URL and answers from a table keyed by endpoint. */
function fakeHttp(table: Record<string, { status: number; body: unknown }>) {
  const calls: URL[] = [];
  const http: Http = async (url) => {
    const u = new URL(url);
    calls.push(u);
    const endpoint = u.pathname.split('/').pop() ?? '';
    const reply = table[endpoint];
    if (reply === undefined) throw new Error(`unexpected endpoint ${endpoint}`);
    return { status: reply.status, json: async () => reply.body };
  };
  return { http, calls };
}

const SEARCH_OK = {
  status: 200,
  body: {
    items: [
      { id: { videoId: 'M7lc1UVf-VE' }, snippet: { title: 'State machines &amp; you', channelTitle: 'Chan', publishedAt: '2024-01-02T03:04:05Z' } },
      { id: { videoId: 'aqz-KE-bpKQ' }, snippet: { title: 'Big Buck Bunny', channelTitle: 'Blender', publishedAt: '2014-11-10T14:00:00Z' } },
    ],
  },
};
const VIDEOS_OK = {
  status: 200,
  body: {
    items: [
      { id: 'M7lc1UVf-VE', contentDetails: { duration: 'PT1H2M3S', caption: 'true' }, snippet: { description: 'no chapters here' } },
      // The second video is absent: videos.list omits what it cannot return.
    ],
  },
};

describe('YouTube upstream: search', () => {
  it('sends the query, date bounds and key; durations come from videos.list', async () => {
    const { http, calls } = fakeHttp({ search: SEARCH_OK, videos: VIDEOS_OK });
    const budget = new SearchBudget();
    budget.restore(0);
    const search = new CatalogSearch(youTubeSearchFetcher(KEY, http), budget, youTubeDurationFiller(KEY, http));
    const outcome = await search.search({ query: 'state machines', publishedAfter: Date.UTC(2020, 0, 1) });

    const call = calls.find((c) => c.pathname.endsWith('/search'));
    expect(call?.searchParams.get('q')).toBe('state machines');
    expect(call?.searchParams.get('type')).toBe('video');
    expect(call?.searchParams.get('publishedAfter')).toBe('2020-01-01T00:00:00.000Z');
    expect(call?.searchParams.has('publishedBefore')).toBe(false);
    expect(call?.searchParams.get('key')).toBe(KEY);
    expect(calls.find((c) => c.pathname.endsWith('/videos'))?.searchParams.get('id')).toBe('M7lc1UVf-VE,aqz-KE-bpKQ');

    expect(outcome.ok && outcome.fromCache).toBe(false);
    expect(outcome.ok && outcome.results).toEqual([
      { videoId: 'M7lc1UVf-VE', title: 'State machines & you', channelTitle: 'Chan', publishedAt: Date.parse('2024-01-02T03:04:05Z'), durationSeconds: 3723 },
      // No duration was returned, so none is claimed — never a zero.
      { videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny', channelTitle: 'Blender', publishedAt: Date.parse('2014-11-10T14:00:00Z') },
    ]);
  });

  it('still returns results when the duration lookup fails, without inventing durations', async () => {
    const { http } = fakeHttp({ search: SEARCH_OK, videos: { status: 500, body: {} } });
    const budget = new SearchBudget();
    budget.restore(0);
    const search = new CatalogSearch(youTubeSearchFetcher(KEY, http), budget, youTubeDurationFiller(KEY, http));
    const outcome = await search.search({ query: 'x' });
    expect(outcome.ok && outcome.results).toHaveLength(2);
    expect(outcome.ok && outcome.results.every((r) => r.durationSeconds === undefined)).toBe(true);
  });

  it('concurrent identical searches both get the durations', async () => {
    const budget = new SearchBudget();
    budget.restore(0);
    const search = new CatalogSearch(
      async () => [{ videoId: 'M7lc1UVf-VE', title: 'a', channelTitle: 'c', publishedAt: 0 }],
      budget,
      async (items) => items.map((i) => ({ ...i, durationSeconds: 42 })),
    );
    const [a, b] = await Promise.all([search.search({ query: 'x' }), search.search({ query: 'x' })]);
    expect(a.ok && a.results[0]?.durationSeconds).toBe(42);
    expect(b.ok && b.results[0]?.durationSeconds).toBe(42);
  });

  it('a stalled duration lookup does not hold a FRESH search either', async () => {
    const budget = new SearchBudget();
    budget.restore(0);
    const search = new CatalogSearch(
      async () => [{ videoId: 'M7lc1UVf-VE', title: 'a', channelTitle: 'c', publishedAt: 0 }],
      budget,
      () => new Promise(() => {}),
      { refillWaitMs: 20 },
    );
    const t0 = Date.now();
    const outcome = await search.search({ query: 'x' });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(outcome.ok && outcome.fromCache).toBe(false);
    expect(outcome.ok && outcome.results[0]?.durationSeconds).toBeUndefined();
  });

  it('raises UpstreamQuotaExhausted on quotaExceeded, and the message never carries the key', async () => {
    const { http } = fakeHttp({
      search: { status: 403, body: { error: { code: 403, message: `quota for key=${KEY}`, errors: [{ reason: 'quotaExceeded' }] } } },
    });
    const err = await youTubeSearchFetcher(KEY, http)({ query: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamQuotaExhausted);
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it('names any other upstream failure without the key', async () => {
    const { http } = fakeHttp({
      search: { status: 400, body: { error: { code: 400, message: `API key not valid ${KEY}`, errors: [{ reason: 'badRequest' }] } } },
    });
    const err = await youTubeSearchFetcher(KEY, http)({ query: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UpstreamQuotaExhausted);
    expect(String((err as Error).message)).toContain('400');
    expect(String((err as Error).message)).toContain('badRequest');
    expect(String((err as Error).message)).not.toContain(KEY);
  });
});

describe('YouTube upstream: failures that are not answers', () => {
  it('a throttle is not the daily quota: it refuses this search without latching the day shut', async () => {
    const { http } = fakeHttp({ search: { status: 403, body: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } } });
    const err = await youTubeSearchFetcher(KEY, http)({ query: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamQuotaExhausted);
    expect((err as UpstreamQuotaExhausted).daily).toBe(false);

    const budget = new SearchBudget();
    budget.restore(0);
    const search = new CatalogSearch(youTubeSearchFetcher(KEY, http), budget);
    const r = await search.search({ query: 'x' });
    expect(r.ok ? '' : r.reason).toBe('quota_exhausted');
    expect(budget.snapshot().searchCallsRemaining).toBe(DAILY_WORKING_CAP - 1);
  });

  it('an unreadable 200 is a failure, never an empty result that gets cached', async () => {
    const calls: string[] = [];
    const http: Http = async (url) => {
      calls.push(url);
      return { status: 200, json: async () => { throw new SyntaxError(`Unexpected end of JSON ${url}`); } };
    };
    const err = await youTubeSearchFetcher(KEY, http)({ query: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it('a 200 with the wrong shape is a failure, never "nothing matched"', async () => {
    for (const body of [null, {}, { items: {} }]) {
      const { http } = fakeHttp({ search: { status: 200, body } });
      await expect(youTubeSearchFetcher(KEY, http)({ query: 'x' })).rejects.toThrow(/items/);
    }
  });

  it('a failed duration lookup is retried on the next cache hit, spending no search quota', async () => {
    let videosUp = false;
    let searches = 0;
    const http: Http = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/search')) {
        searches += 1;
        return { status: 200, json: async () => SEARCH_OK.body };
      }
      if (!videosUp) return { status: 503, json: async () => ({}) };
      return { status: 200, json: async () => VIDEOS_OK.body };
    };
    const budget = new SearchBudget();
    budget.restore(0);
    const search = new CatalogSearch(youTubeSearchFetcher(KEY, http), budget, youTubeDurationFiller(KEY, http));

    const first = await search.search({ query: 'x' });
    expect(first.ok && first.results.map((r) => r.durationSeconds)).toEqual([undefined, undefined]);

    videosUp = true;
    const second = await search.search({ query: 'x' });
    expect(second.ok && second.fromCache).toBe(true);
    expect(second.ok && second.results.map((r) => r.durationSeconds)).toEqual([3723, undefined]);
    expect(searches).toBe(1);
    expect(budget.spentToday()).toBe(1);
  });

  it('a stalled refill does not hold a cached search: it serves what is known and lands later', async () => {
    const budget = new SearchBudget();
    budget.restore(0);
    let land: (() => void) | undefined;
    let fillStarted = false;
    const search = new CatalogSearch(
      async () => [{ videoId: 'M7lc1UVf-VE', title: 'a', channelTitle: 'c', publishedAt: 0 }],
      budget,
      (items) => {
        if (!fillStarted) {
          fillStarted = true;
          return Promise.reject(new Error('first fill fails'));
        }
        return new Promise((r) => { land = () => { r(items.map((i) => ({ ...i, durationSeconds: 90 }))); }; });
      },
      { refillWaitMs: 20 },
    );
    await search.search({ query: 'x' });
    await search.search({ query: 'x' }); // consumes the failing fill

    const t0 = Date.now();
    const stalled = await search.search({ query: 'x' });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(stalled.ok && stalled.fromCache).toBe(true);
    expect(stalled.ok && stalled.results[0]?.durationSeconds).toBeUndefined();

    land?.();
    await new Promise((r) => setTimeout(r, 0));
    const later = await search.search({ query: 'x' });
    expect(later.ok && later.results[0]?.durationSeconds).toBe(90);
  });

  it('overlapping fills share one lookup and never erase an established duration', async () => {
    let fills = 0;
    const budget = new SearchBudget();
    budget.restore(0);
    let answer: 'fail' | 'full' = 'fail';
    const release: (() => void)[] = [];
    const search = new CatalogSearch(
      async () => [
        { videoId: 'M7lc1UVf-VE', title: 'a', channelTitle: 'c', publishedAt: 0 },
        { videoId: 'aqz-KE-bpKQ', title: 'b', channelTitle: 'c', publishedAt: 0 },
      ],
      budget,
      async (items) => {
        fills += 1;
        if (answer === 'fail') throw new Error('videos.list down');
        await new Promise<void>((r) => release.push(r));
        return items.map((i) => (i.videoId === 'M7lc1UVf-VE' ? { ...i, durationSeconds: 60 } : i));
      },
    );
    await search.search({ query: 'x' }); // the fresh search's own fill fails: no durations
    fills = 0; // counted from here: the claim is about the overlapping pair below
    answer = 'full';
    const a = search.search({ query: 'x' });
    const b = search.search({ query: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    release.forEach((r) => r());
    const [ra, rb] = await Promise.all([a, b]);
    expect(fills).toBe(1);
    expect(ra.ok && ra.results[0]?.durationSeconds).toBe(60);
    expect(rb.ok && rb.results[0]?.durationSeconds).toBe(60);

    // A later fill that establishes nothing must not take the 60 back.
    answer = 'fail';
    const rc = await search.search({ query: 'x' });
    expect(rc.ok && rc.results[0]?.durationSeconds).toBe(60);
  });

  it('identical searches straddling a completion share one upstream call', async () => {
    let calls = 0;
    const pending: (() => void)[] = [];
    const budget = new SearchBudget();
    budget.restore(0);
    const result = [{ videoId: 'M7lc1UVf-VE', title: 'a', channelTitle: 'c', publishedAt: 0, durationSeconds: 60 }];
    const search = new CatalogSearch(
      // Returned directly, not from an async function, so the first search
      // resumes on the very next microtask after it is settled — inside the gap
      // an await on the second search's miss path opens. Verified to make two
      // upstream calls with that await restored, one without.
      () => {
        calls += 1;
        return new Promise((r) => { pending.push(() => { r(result); }); });
      },
      budget,
      async (items) => items,
    );
    const first = search.search({ query: 'x' });
    while (pending.length === 0) await Promise.resolve(); // the first upstream call is really in flight
    pending[0]?.(); // its completion is queued…
    const second = search.search({ query: 'x' }); // …before the second search starts
    await new Promise((r) => setTimeout(r, 0));
    pending.forEach((settle) => { settle(); }); // a duplicate call, if any, must not hang the test
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    expect(calls).toBe(1);
    expect(budget.spentToday()).toBe(1);
  });

  it('a live or upcoming video has no length yet, not a length of zero', async () => {
    const { http } = fakeHttp({
      videos: {
        status: 200,
        body: {
          items: [
            { id: 'M7lc1UVf-VE', contentDetails: { duration: 'PT0S' }, snippet: {} },
            { id: 'aqz-KE-bpKQ', contentDetails: { duration: 'P0D' }, snippet: {} },
          ],
        },
      },
    });
    const details = await youTubeVideoDetailsFetcher(KEY, http)(['M7lc1UVf-VE', 'aqz-KE-bpKQ']);
    expect(details.map((d) => d.durationSeconds)).toEqual(['unknown', 'unknown']);
    const filled = await youTubeDurationFiller(KEY, http)([
      { videoId: 'M7lc1UVf-VE', title: 'live', channelTitle: 'c', publishedAt: 0 },
    ]);
    expect(filled[0]?.durationSeconds).toBeUndefined();
  });

  it('looks up every requested id, in batches of 50, rather than dropping the rest', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `vid${String(i).padStart(8, '0')}`);
    const seen: string[][] = [];
    const http: Http = async (url) => {
      const batch = (new URL(url).searchParams.get('id') ?? '').split(',');
      seen.push(batch);
      return { status: 200, json: async () => ({ items: batch.map((id) => ({ id, contentDetails: { duration: 'PT1M' }, snippet: {} })) }) };
    };
    const details = await youTubeVideoDetailsFetcher(KEY, http)(ids);
    expect(seen.map((b) => b.length)).toEqual([50, 1]);
    expect(details.map((d) => d.videoId)).toEqual(ids);
  });
});

describe('YouTube upstream: the default client', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('gives every request a deadline', async () => {
    const signals: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: { signal?: unknown }) => {
      signals.push(init?.signal);
      return { status: 200, json: async () => ({ items: [] }) };
    });
    await youTubeSearchFetcher(KEY)({ query: 'x' });
    await youTubeVideoDetailsFetcher(KEY)(['M7lc1UVf-VE']);
    expect(signals).toHaveLength(2);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
  });
});

describe('YouTube upstream: video details', () => {
  it('keeps captions and chapters three-valued', async () => {
    const description = '0:00 Intro\n1:30 The problem\n12:05 The fix\nThanks for watching';
    const { http } = fakeHttp({
      videos: {
        status: 200,
        body: {
          items: [
            { id: 'M7lc1UVf-VE', contentDetails: { duration: 'PT15M', caption: 'true' }, snippet: { description } },
            { id: 'aqz-KE-bpKQ', contentDetails: { duration: 'PT10M', caption: 'false' }, snippet: { description: '' } },
          ],
        },
      },
    });
    const [a, b] = await youTubeVideoDetailsFetcher(KEY, http)(['M7lc1UVf-VE', 'aqz-KE-bpKQ']);
    expect(a).toEqual({
      videoId: 'M7lc1UVf-VE',
      durationSeconds: 900,
      hasCaptions: true,
      chapters: [
        { title: 'Intro', startSeconds: 0 },
        { title: 'The problem', startSeconds: 90 },
        { title: 'The fix', startSeconds: 725 },
      ],
    });
    // caption:"false" means no UPLOADED track; auto-generated captions are not
    // reported by the API, so it is not evidence of "no captions".
    expect(b?.hasCaptions).toBe('unknown');
    // No chapter list in the description is not evidence of no chapters either.
    expect(b?.chapters).toBe('unknown');
  });
});

describe('chapter parsing follows YouTube’s own rules', () => {
  it('requires a 0:00 start, three entries, ascending, at least 10s apart', () => {
    expect(parseChapters('1:00 a\n2:00 b\n3:00 c')).toBeUndefined();
    expect(parseChapters('0:00 a\n2:00 b')).toBeUndefined();
    expect(parseChapters('0:00 a\n0:05 b\n1:00 c')).toBeUndefined();
    expect(parseChapters('0:00 a\n2:00 b\n1:00 c')).toBeUndefined();
    // A timestamp is read whole, with valid fields, and needs a title.
    expect(parseChapters('0:00:00\n0:30:00\n1:00:00')).toBeUndefined();
    expect(parseChapters('0:00 a\n1:90 b\n3:00 c')).toBeUndefined();
    expect(parseChapters('0:00:00 a\n0:30:00 b\n1:00:00 c')?.map((c) => c.startSeconds)).toEqual([0, 1800, 3600]);
    expect(parseChapters('0:00 a\n1:75:00 b\n2:00:00 c')).toBeUndefined();
    // Checked against the video's own length when it is known.
    expect(parseChapters('0:00 a\n0:10 b\n1:00 c', 25)).toBeUndefined();
    expect(parseChapters('0:00 a\n0:30 b\n1:00 c', 65)).toBeUndefined();
    expect(parseChapters('0:00 a\n0:30 b\n1:00 c', 70)).toHaveLength(3);
    expect(parseChapters('00:00 - a\n1:02:03 b\n1:05:00 c')).toEqual([
      { title: 'a', startSeconds: 0 },
      { title: 'b', startSeconds: 3723 },
      { title: 'c', startSeconds: 3900 },
    ]);
  });
});

describe('a quota refusal belongs to the day it was requested in', () => {
  it('is ignored when the day has turned before it arrived', () => {
    const beforeMidnight = new SearchBudget(Date.UTC(2026, 8, 13, 6, 59, 0)); // 23:59 Pacific (PDT)
    beforeMidnight.restore(10, Date.UTC(2026, 8, 13, 6, 59, 0));
    const requestedIn = beforeMidnight.snapshot(Date.UTC(2026, 8, 13, 6, 59, 0)).resetsAt;

    const afterMidnight = Date.UTC(2026, 8, 13, 7, 0, 30);
    beforeMidnight.markExhausted(requestedIn, afterMidnight);
    expect(beforeMidnight.snapshot(afterMidnight).searchCallsRemaining).toBe(DAILY_WORKING_CAP);

    // Within the same day it still latches.
    const sameDay = new SearchBudget(Date.UTC(2026, 8, 13, 5, 0, 0));
    sameDay.restore(10, Date.UTC(2026, 8, 13, 5, 0, 0));
    sameDay.markExhausted(sameDay.snapshot(Date.UTC(2026, 8, 13, 5, 0, 0)).resetsAt, Date.UTC(2026, 8, 13, 5, 0, 1));
    expect(sameDay.snapshot(Date.UTC(2026, 8, 13, 5, 0, 1)).searchCallsRemaining).toBe(0);
  });
});

describe('upstream quota exhaustion reaches the budget', () => {
  it('answers quota_exhausted and stops spending for the rest of the day', async () => {
    const budget = new SearchBudget();
    budget.restore(0);
    let upstreamCalls = 0;
    const search = new CatalogSearch(async () => {
      upstreamCalls += 1;
      throw new UpstreamQuotaExhausted('YouTube reports the daily quota is spent.', true);
    }, budget);

    const first = await search.search({ query: 'a' });
    expect(first.ok).toBe(false);
    expect(first.ok ? '' : first.reason).toBe('quota_exhausted');
    // Upstream is authoritative: the local counter was wrong, so it is corrected.
    expect(budget.snapshot().searchCallsRemaining).toBe(0);
    expect(budget.spentToday()).toBeGreaterThanOrEqual(DAILY_WORKING_CAP);

    await search.search({ query: 'b' });
    expect(upstreamCalls).toBe(1);
  });
});
