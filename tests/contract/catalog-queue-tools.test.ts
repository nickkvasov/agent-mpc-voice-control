import { describe, expect, it } from 'vitest';
import { narrowLocally, describeCriteria, EMPTY, type ResultSet } from '../../src/catalog/results.ts';
import { resolveReference } from '../../src/catalog/tools/resolve.ts';
import { add, clear, remove, reorder, EMPTY_QUEUE } from '../../src/queue/queue.ts';
import { makeVideoReference } from '../../src/store/video-reference.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';
import { SearchBudget, DAILY_WORKING_CAP, BURST, REPLENISH_MS } from '../../server/catalog-proxy/budget.ts';

const vid = (id: string, title: string, dur: number, published = 0) =>
  makeVideoReference({ videoId: id, title, channelTitle: 'c', durationSeconds: dur, publishedAt: published });

const results = (...items: ReturnType<typeof vid>[]): ResultSet => ({ ...EMPTY, items, operation: 'fresh_search' });

describe('narrowing', () => {
  const set = results(vid('aaaaaaaaaaa', 'Short talk', 120), vid('bbbbbbbbbbb', 'Long talk', 3600));

  it('filters within the current results and keeps prior criteria', () => {
    const r = narrowLocally({ ...set, criteria: { query: 'talks' } }, { maxDurationSeconds: 600 });
    expect(r.items.map((v) => v.videoId)).toEqual(['aaaaaaaaaaa']);
    expect(r.criteria.query).toBe('talks');
    expect(r.operation).toBe('narrowed');
  });

  it('counts a filter that changes nothing as narrowed, not unchanged', () => {
    // The criteria changed even though the visible set did not.
    const r = narrowLocally(set, { maxDurationSeconds: 99999 });
    expect(r.items).toHaveLength(2);
    expect(r.operation).toBe('narrowed');
  });

  it('reports unchanged only when the criteria repeat', () => {
    const once = narrowLocally(set, { maxDurationSeconds: 600 });
    expect(narrowLocally(once, { maxDurationSeconds: 600 }).operation).toBe('unchanged');
  });

  it('never falls back to a search when narrowing empties the set', () => {
    const r = narrowLocally(set, { maxDurationSeconds: 1 });
    expect(r.items).toHaveLength(0);
    expect(r.operation).toBe('narrowed');
  });

  it('states the criteria in plain language', () => {
    expect(describeCriteria({ query: 'state machines', maxDurationSeconds: 600 })).toMatch(/state machines.*under 10 minutes/);
    expect(describeCriteria({})).toBe('no filters');
  });
});

describe('reference resolution', () => {
  const items = [vid('aaaaaaaaaaa', 'Intro to launches', 100), vid('bbbbbbbbbbb', 'Pricing deep dive', 200), vid('ccccccccccc', 'Launch retrospective', 300)];

  it('resolves an ordinal and says how', () => {
    const r = resolveReference(items, 'the second one');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.videoId).toBe('bbbbbbbbbbb'); expect(r.value.how).toBe('result 2'); }
  });

  it('resolves the shortest', () => {
    const r = resolveReference(items, 'the shortest');
    if (r.ok) expect(r.value.videoId).toBe('aaaaaaaaaaa');
  });

  it('asks rather than choosing when a description matches two (FR-018)', () => {
    const r = resolveReference(items, 'the one about launch');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe(REFUSAL_REASON.ambiguousReference); expect(r.detail).toMatch(/Which one/); }
  });

  it('refuses an index beyond the results rather than clamping', () => {
    const r = resolveReference(items, 'the ninth one');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/there are 3/);
  });
});

describe('queue', () => {
  it('adds, removes and reorders', () => {
    const a = add(EMPTY_QUEUE, ['x', 'y']);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(reorder(a.value, 'y', 0).ok).toBe(true);
    expect(remove(a.value, ['x']).ok).toBe(true);
  });

  it('allows the same video twice — watching again is not a duplicate', () => {
    const a = add(EMPTY_QUEUE, ['x']);
    if (!a.ok) return;
    const b = add(a.value, ['x']);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.value.items).toEqual(['x', 'x']);
  });

  it('requires confirmation above the bulk threshold', () => {
    const r = add(EMPTY_QUEUE, ['1', '2', '3', '4', '5', '6']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.needsConfirmation);
  });

  it('requires the count to clear a large queue', () => {
    const big = { items: ['1', '2', '3', '4', '5', '6'], currentVideoId: null };
    expect(clear(big).ok).toBe(false);
    expect(clear(big, 5).ok).toBe(false);
    expect(clear(big, 6).ok).toBe(true);
  });

  it('refuses to remove something that is not there', () => {
    expect(remove(EMPTY_QUEUE, ['nope']).ok).toBe(false);
  });
});

describe('search budget', () => {
  it('reports an unknown balance until usage is established', () => {
    expect(new SearchBudget().snapshot().searchCallsRemaining).toBeNull();
  });

  it('allows a burst then paces, so one sitting cannot drain the day', () => {
    const now = Date.now();
    const b = new SearchBudget(now);
    b.restore(0, now);
    for (let i = 0; i < BURST; i += 1) expect(b.request(now).allowed).toBe(true);
    const denied = b.request(now);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) { expect(denied.reason).toBe('rate'); expect(denied.detail).toMatch(/still works/); }
  });

  it('replenishes over time', () => {
    const now = Date.now();
    const b = new SearchBudget(now);
    b.restore(0, now);
    b.request(now); b.request(now);
    expect(b.request(now + REPLENISH_MS).allowed).toBe(true);
  });

  it('holds a reserve back from ordinary traffic', () => {
    const now = Date.now();
    const b = new SearchBudget(now);
    b.restore(DAILY_WORKING_CAP, now);
    const r = b.request(now);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('daily_cap');
  });
});
