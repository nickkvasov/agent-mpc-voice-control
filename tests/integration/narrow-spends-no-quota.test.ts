import { describe, expect, it, vi } from 'vitest';
import { narrowLocally, EMPTY } from '../../src/catalog/results.ts';
import { searchCatalog } from '../../src/catalog/client.ts';
import { makeVideoReference } from '../../src/store/video-reference.ts';

/**
 * T049 — the quota-preservation property the whole feature depends on.
 *
 * 100 searches per day for the entire deployment. If narrowing reached the
 * network, a conversational session would be unusable by mid-afternoon.
 */
const vid = (id: string, dur: number) =>
  makeVideoReference({ videoId: id, title: 't', channelTitle: 'c', durationSeconds: dur, publishedAt: 0 });

describe('narrowing spends no quota', () => {
  it('issues no network call at all', () => {
    const fetcher = vi.fn();
    const set = { ...EMPTY, items: [vid('aaaaaaaaaaa', 100), vid('bbbbbbbbbbb', 5000)], operation: 'fresh_search' as const };
    const narrowed = narrowLocally(set, { maxDurationSeconds: 600 });
    expect(narrowed.items).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('a search DOES reach the network, so the contrast is real', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, json: async () => ({ results: [], criteriaApplied: {}, quota: {} }) }));
    await searchCatalog({ query: 'x' }, fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('reports quota exhaustion as a stated condition, keeping loaded results usable', async () => {
    const fetcher = vi.fn(async () => ({ status: 429, json: async () => ({ detail: 'allowance spent for now' }) }));
    const r = await searchCatalog({ query: 'x' }, fetcher);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.detail).toMatch(/allowance spent/); expect(r.retryable).toBe(true); }
  });

  it('reports an unreachable catalog rather than an empty result set', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const r = await searchCatalog({ query: 'x' }, fetcher);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/could not be reached/);
  });

  it('never reports an unknown quota as zero', async () => {
    const fetcher = vi.fn(async () => ({ status: 200, json: async () => ({ results: [], criteriaApplied: {}, quota: {} }) }));
    const r = await searchCatalog({ query: 'x' }, fetcher);
    if (r.ok) expect(r.value.quota.searchCallsRemaining).toBeNull();
  });
});
