import { describe, expect, it } from 'vitest';
import { searchCatalog } from '../../src/catalog/client.ts';

/**
 * search.list carries no duration and the videos.list that fills it can fail.
 * The page must then store UNKNOWN: the fixtures elsewhere always supplied a
 * duration, which is how a `?? 0` default survived a green suite and made every
 * live result "0 min".
 */
describe('catalog client: a duration the backend did not establish', () => {
  it('stays unknown rather than becoming zero', async () => {
    const result = await searchCatalog({ query: 'x' }, async () => ({
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          { videoId: 'M7lc1UVf-VE', title: 'has one', channelTitle: 'c', publishedAt: 0, durationSeconds: 600 },
          { videoId: 'aqz-KE-bpKQ', title: 'has none', channelTitle: 'c', publishedAt: 0 },
        ],
        criteriaApplied: { query: 'x' },
        fromCache: false,
        quota: { searchCallsRemaining: null, resetsAt: 0 },
      }),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((v) => v.durationSeconds)).toEqual([600, 'unknown']);
  });
});
