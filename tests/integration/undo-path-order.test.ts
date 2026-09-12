import { describe, expect, it } from 'vitest';
import { applyQueueUndo } from '../../src/queue/restore.ts';
import type { Effect } from '../../src/activity/effects.ts';
import type { QueueState } from '../../src/queue/queue.ts';

/**
 * Drives the function the Undo handler actually calls.
 *
 * Two Gate C rounds were spent on a fix that was written, exported, tested and
 * never invoked; the logic is a module function now so breaking it turns these
 * red (verified). Restoration is by stable sort key, so the outcome does not
 * depend on the order the undos happen in — which is what every anchor scheme
 * got wrong.
 */
const q = (...t: [string, string, number][]): QueueState => ({
  items: t.map(([entryId, videoId, order]) => ({ entryId, videoId, order })),
  currentVideoId: null,
});

const removal = (entryId: string, videoId: string, order: number): Effect =>
  ({ kind: 'queue_occurrence', entryId, videoId, added: false, order });
const addition = (entryId: string, videoId: string, order: number): Effect =>
  ({ kind: 'queue_occurrence', entryId, videoId, added: true, order });

const ids = (s: QueueState) => s.items.map((i) => i.videoId);

describe('applyQueueUndo', () => {
  it('rebuilds [A,B,C,D] after removing C, D, A and undoing in the SAME order', () => {
    // The case Gate C found: C and D shared a predecessor, so anchor-based
    // restoration produced [A,B,D,C].
    let s = q(['q2', 'B', 2]);
    s = applyQueueUndo(s, removal('q3', 'C', 3)) as QueueState;
    s = applyQueueUndo(s, removal('q4', 'D', 4)) as QueueState;
    s = applyQueueUndo(s, removal('q1', 'A', 1)) as QueueState;
    expect(ids(s)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('rebuilds it in reverse undo order too', () => {
    let s = q(['q2', 'B', 2]);
    s = applyQueueUndo(s, removal('q1', 'A', 1)) as QueueState;
    s = applyQueueUndo(s, removal('q4', 'D', 4)) as QueueState;
    s = applyQueueUndo(s, removal('q3', 'C', 3)) as QueueState;
    expect(ids(s)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('restores a middle entry between its neighbours', () => {
    const s = applyQueueUndo(q(['q1', 'A', 1], ['q3', 'C', 3]), removal('q2', 'B', 2)) as QueueState;
    expect(ids(s)).toEqual(['A', 'B', 'C']);
  });

  it('restores a first entry to the front', () => {
    const s = applyQueueUndo(q(['q2', 'B', 2]), removal('q1', 'A', 1)) as QueueState;
    expect(ids(s)).toEqual(['A', 'B']);
  });

  it('undoes an addition by removing that occurrence', () => {
    const s = applyQueueUndo(q(['q1', 'A', 1], ['q2', 'B', 2]), addition('q1', 'A', 1)) as QueueState;
    expect(ids(s)).toEqual(['B']);
  });

  it('returns null when nothing changed, so the caller refuses instead of claiming success', () => {
    expect(applyQueueUndo(q(['q2', 'B', 2]), removal('q2', 'B', 2))).toBeNull();
    expect(applyQueueUndo(q(['q1', 'A', 1]), addition('q9', 'Z', 9))).toBeNull();
  });
});
