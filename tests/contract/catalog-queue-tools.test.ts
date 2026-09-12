import { describe, expect, it } from 'vitest';
import { narrowLocally, describeCriteria, EMPTY, type ResultSet } from '../../src/catalog/results.ts';
import { resolveReference } from '../../src/catalog/tools/resolve.ts';
import { add, clear, removeEntries, removeVideo, reorder, EMPTY_QUEUE, newEntry } from '../../src/queue/queue.ts';
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
    const second = a.value.items[1] as { entryId: string };
    expect(reorder(a.value, second.entryId, 0).ok).toBe(true);
    expect(removeVideo(a.value, ['x']).ok).toBe(true);
  });

  it('allows the same video twice — watching again is not a duplicate', () => {
    const a = add(EMPTY_QUEUE, ['x']);
    if (!a.ok) return;
    const b = add(a.value, ['x']);
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.value.items.map((e) => e.videoId)).toEqual(['x', 'x']);
  });

  it('requires confirmation above the bulk threshold', () => {
    const r = add(EMPTY_QUEUE, ['1', '2', '3', '4', '5', '6']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.needsConfirmation);
  });

  it('requires the count to clear a large queue', () => {
    const big = { items: ['1', '2', '3', '4', '5', '6'].map(newEntry), currentVideoId: null };
    expect(clear(big).ok).toBe(false);
    expect(clear(big, 5).ok).toBe(false);
    expect(clear(big, 6).ok).toBe(true);
  });

  it('refuses to remove something that is not there', () => {
    expect(removeVideo(EMPTY_QUEUE, ['nope']).ok).toBe(false);
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

describe('Gate C round 1 regressions', () => {
  const withDur = (id: string, title: string, dur: number) =>
    makeVideoReference({ videoId: id, title, channelTitle: 'c', durationSeconds: dur, publishedAt: 0 });
  const noDur = (id: string, title: string) =>
    makeVideoReference({ videoId: id, title, channelTitle: 'c', publishedAt: 0 });

  it('a duration is unknown until fetched, never zero', () => {
    expect(noDur('aaaaaaaaaaa', 't').durationSeconds).toBe('unknown');
  });

  it('sets aside unknown-duration items instead of silently keeping or dropping them', () => {
    const set = results(withDur('aaaaaaaaaaa', 'short', 120), noDur('bbbbbbbbbbb', 'mystery'));
    const r = narrowLocally(set, { maxDurationSeconds: 600 });
    expect(r.items.map((v) => v.videoId)).toEqual(['aaaaaaaaaaa']);
    expect(r.setAsideUnknown).toBe(1);
  });

  it('keeps the tighter bound when a looser one is supplied', () => {
    const set = results(withDur('aaaaaaaaaaa', 'a', 120), withDur('bbbbbbbbbbb', 'b', 3600));
    const tight = narrowLocally(set, { maxDurationSeconds: 600 });
    const loosened = narrowLocally(tight, { maxDurationSeconds: 1200 });
    // The displayed criterion must still describe the set that is shown.
    expect(loosened.criteria.maxDurationSeconds).toBe(600);
  });

  it('does not treat a number inside a title as a position', () => {
    const items = [withDur('aaaaaaaaaaa', 'Unrelated talk', 100), withDur('bbbbbbbbbbb', 'Apollo 1', 200)];
    const r = resolveReference(items, 'the one about Apollo 1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.videoId).toBe('bbbbbbbbbbb');
  });

  it('still resolves an explicit position', () => {
    const items = [withDur('aaaaaaaaaaa', 'a', 100), withDur('bbbbbbbbbbb', 'b', 200)];
    for (const phrase of ['the second one', 'number 2', '2']) {
      const r = resolveReference(items, phrase);
      expect(r.ok, phrase).toBe(true);
      if (r.ok) expect(r.value.videoId, phrase).toBe('bbbbbbbbbbb');
    }
  });

  it('refuses "the shortest" when no length is established', () => {
    const r = resolveReference([noDur('aaaaaaaaaaa', 'a')], 'the shortest');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/established length/i);
  });

  it('removes one occurrence of a repeated video, not both', () => {
    const q = { items: ['A', 'B', 'A'].map(newEntry), currentVideoId: null };
    const first = q.items[0] as { entryId: string };
    const r = removeEntries(q, [first.entryId]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items.map((e) => e.videoId)).toEqual(['B', 'A']);
  });

  it('gates a bulk removal and then allows it once the count is confirmed', () => {
    const q = { items: ['1', '2', '3', '4', '5', '6'].map(newEntry), currentVideoId: null };
    const ids = q.items.map((e) => e.entryId);
    expect(removeEntries(q, ids).ok).toBe(false);
    expect(removeEntries(q, ids, 6).ok).toBe(true);
  });

  it('allows a bulk add once the count is confirmed, rather than forbidding it forever', () => {
    const ids = ['1', '2', '3', '4', '5', '6'];
    expect(add(EMPTY_QUEUE, ids).ok).toBe(false);
    const r = add(EMPTY_QUEUE, ids, 'end', 6);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toHaveLength(6);
  });
});

describe('Gate C round 2 regressions', () => {
  const withDur = (id: string, title: string, dur: number) =>
    makeVideoReference({ videoId: id, title, channelTitle: 'c', durationSeconds: dur, publishedAt: 0 });
  const noDur = (id: string, title: string) =>
    makeVideoReference({ videoId: id, title, channelTitle: 'c', publishedAt: 0 });

  it('still resolves explicit positional forms', () => {
    const items = [withDur('aaaaaaaaaaa', 'a', 100), withDur('bbbbbbbbbbb', 'b', 200)];
    for (const phrase of ['#2', 'result #2', '2nd', '2nd one', 'the 2nd', 'number 2', '2', 'the second one']) {
      const r = resolveReference(items, phrase);
      expect(r.ok, phrase).toBe(true);
      if (r.ok) expect(r.value.videoId, phrase).toBe('bbbbbbbbbbb');
    }
  });

  it('still ignores a digit that is only part of a title', () => {
    const items = [withDur('aaaaaaaaaaa', 'Unrelated talk', 100), withDur('bbbbbbbbbbb', 'Apollo 1', 200)];
    const r = resolveReference(items, 'the one about Apollo 1');
    if (r.ok) expect(r.value.videoId).toBe('bbbbbbbbbbb');
  });

  it('keeps the unknown-length explanation across repeated narrowing', () => {
    const set = results(withDur('aaaaaaaaaaa', 'short', 120), noDur('bbbbbbbbbbb', 'mystery'));
    const once = narrowLocally(set, { maxDurationSeconds: 600 });
    expect(once.setAsideUnknown).toBe(1);
    const twice = narrowLocally(once, { maxDurationSeconds: 600 });
    // The criterion is still in force, so the explanation must not vanish.
    expect(twice.setAsideUnknown).toBe(1);
  });

  it('applies each queued mutation to the CURRENT queue, not a captured snapshot', () => {
    // Models the App bug: both callbacks were built from the same snapshot, so
    // the second add replaced the first instead of appending.
    let current = EMPTY_QUEUE;
    const apply = (run: (cur: typeof current) => ReturnType<typeof add>) => {
      const r = run(current);
      if (r.ok) current = r.value;
    };
    apply((cur) => add(cur, ['A']));
    apply((cur) => add(cur, ['B']));
    expect(current.items.map((e) => e.videoId)).toEqual(['A', 'B']);
  });
});

describe('Gate C round 3 regressions', () => {
  const withDur = (id: string, title: string, dur: number) =>
    makeVideoReference({ videoId: id, title, channelTitle: 'c', durationSeconds: dur, publishedAt: 0 });

  it('a delayed removal deletes the clicked entry, not whatever moved into its slot', () => {
    // Gate C: with [A,B,C], clicking A's Remove twice during a slow search made
    // the second click delete B while claiming it removed A.
    const q = { items: ['A', 'B', 'C'].map(newEntry), currentVideoId: null };
    const aEntry = q.items[0] as { entryId: string };
    const first = removeEntries(q, [aEntry.entryId]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The same command applied again to the CHANGED queue must not hit B.
    const second = removeEntries(first.value, [aEntry.entryId]);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.detail).toMatch(/no longer in the queue|removed already/);
    expect(first.value.items.map((e) => e.videoId)).toEqual(['B', 'C']);
  });

  it('does not read a number inside a title as a position', () => {
    const items = [withDur('aaaaaaaaaaa', 'Unrelated talk', 100), withDur('bbbbbbbbbbb', 'Apollo #1', 200)];
    const r = resolveReference(items, 'the one about Apollo #1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.videoId).toBe('bbbbbbbbbbb');
  });

  it('does not read an ordinal inside a title as a position', () => {
    const items = [
      withDur('aaaaaaaaaaa', 'Unrelated talk', 100),
      withDur('bbbbbbbbbbb', 'Cookies explained', 150),
      withDur('ccccccccccc', '3rd party cookies', 200),
    ];
    const r = resolveReference(items, 'the one about 3rd party cookies');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.videoId).toBe('ccccccccccc');
  });

  it('accepts punctuation after an ordinal', () => {
    const items = [withDur('aaaaaaaaaaa', 'a', 100), withDur('bbbbbbbbbbb', 'b', 200)];
    for (const phrase of ['the 2nd.', 'the 2nd, please', '#2', '2nd one', 'number 2', 'the second one']) {
      const r = resolveReference(items, phrase);
      expect(r.ok, phrase).toBe(true);
      if (r.ok) expect(r.value.videoId, phrase).toBe('bbbbbbbbbbb');
    }
  });
});

describe('Gate C round 4 regressions', () => {
  const withDur = (id: string, title: string, dur: number) =>
    makeVideoReference({ videoId: id, title, channelTitle: 'c', durationSeconds: dur, publishedAt: 0 });

  const items = [withDur('aaaaaaaaaaa', 'Video encoding basics', 100), withDur('bbbbbbbbbbb', 'Pricing deep dive', 200)];

  it('resolves an ordinal followed by the counted noun', () => {
    for (const phrase of ['the second video', 'the 2nd video', '2nd clip', 'the last video']) {
      const r = resolveReference(items, phrase);
      expect(r.ok, phrase).toBe(true);
      if (r.ok) expect(r.value.videoId, phrase).toBe('bbbbbbbbbbb');
    }
  });

  it('still treats a title that contains "video" as a title reference', () => {
    const r = resolveReference(items, 'the one about video encoding');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.videoId).toBe('aaaaaaaaaaa');
  });
});
