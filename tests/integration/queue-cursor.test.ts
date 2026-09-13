import { describe, expect, it } from 'vitest';
import { __resetQueueIds, add, EMPTY_QUEUE, newEntry, sorted } from '../../src/queue/queue.ts';

/** Phase 10 Gate C round 1: "next" means after what is playing, not the front of the queue. */
describe('queue add at position "next"', () => {
  it('inserts immediately after the current entry', () => {
    __resetQueueIds();
    const two = add(EMPTY_QUEUE, ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    if (!two.ok) throw new Error('setup');
    const current = two.value.items[0]?.entryId ?? null;
    const playingA = { ...two.value, currentEntryId: current };
    const r = add(playingA, ['CCCCCCCCCCC', 'DDDDDDDDDDD'], 'next');
    expect(r.ok && sorted(r.value.items).map((e) => e.videoId)).toEqual(['AAAAAAAAAAA', 'CCCCCCCCCCC', 'DDDDDDDDDDD', 'BBBBBBBBBBB']);
  });

  it('still goes to the front when nothing from the queue is playing', () => {
    __resetQueueIds();
    const two = add(EMPTY_QUEUE, ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    if (!two.ok) throw new Error('setup');
    const r = add(two.value, ['CCCCCCCCCCC'], 'next');
    expect(r.ok && sorted(r.value.items).map((e) => e.videoId)).toEqual(['CCCCCCCCCCC', 'AAAAAAAAAAA', 'BBBBBBBBBBB']);
  });

  it('after the last entry, still after it — and a later append still lands after that', () => {
    __resetQueueIds();
    const two = add(EMPTY_QUEUE, ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
    if (!two.ok) throw new Error('setup');
    const playingB = { ...two.value, currentEntryId: two.value.items[1]?.entryId ?? null };
    const next = add(playingB, ['CCCCCCCCCCC'], 'next');
    if (!next.ok) throw new Error('setup');
    const appended = add(next.value, ['DDDDDDDDDDD']);
    expect(appended.ok && sorted(appended.value.items).map((e) => e.videoId)).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD']);
  });

  it('[round 2] tail insertions keep the append counter ahead, so a later append still lands last', () => {
    __resetQueueIds();
    let q = add(EMPTY_QUEUE, ['AAAAAAAAAAA']);
    for (const id of ['BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD']) {
      if (!q.ok) throw new Error('setup');
      const last = sorted(q.value.items).at(-1)?.entryId ?? null;
      q = add({ ...q.value, currentEntryId: last }, [id], 'next');
    }
    if (!q.ok) throw new Error('setup');
    const appended = add(q.value, ['EEEEEEEEEEE']);
    expect(appended.ok && sorted(appended.value.items).map((e) => e.videoId[0])).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('[round 2] refuses a "next" insertion when the neighbouring keys leave no room, rather than misplacing it', () => {
    __resetQueueIds();
    const q = {
      currentEntryId: 'q1',
      items: [newEntry('AAAAAAAAAAA', 1), newEntry('CCCCCCCCCCC', 1.5), newEntry('DDDDDDDDDDD', 1.5)],
    };
    const current = { ...q, currentEntryId: q.items[1]?.entryId ?? null };
    const r = add(current, ['EEEEEEEEEEE'], 'next');
    // The same reason `reorder` gives for the same tie.
    expect(r.ok ? '' : r.reason).toBe('effect_unverifiable');
  });
});

