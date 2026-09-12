import { describe, expect, it } from 'vitest';
import { applyQueueUndo, restorePosition } from '../../src/queue/restore.ts';
import type { Effect } from '../../src/activity/effects.ts';
import type { QueueState } from '../../src/queue/queue.ts';

/**
 * Drives the function the Undo handler actually calls.
 *
 * Two rounds of Gate C were spent on this: the fix was written, exported as a
 * helper and unit-tested while `undoAction` kept using the stale index, so the
 * application behaved exactly as before and the suite stayed green. The logic is
 * now a module function that App calls in one line, so breaking it turns these
 * red — which was verified by breaking it.
 */
const q = (...pairs: [string, string][]): QueueState => ({
  items: pairs.map(([entryId, videoId]) => ({ entryId, videoId })),
  currentVideoId: null,
});

const removal = (
  entryId: string, videoId: string, index: number,
  afterEntryId: string | null, beforeEntryId: string | null,
): Effect => ({ kind: 'queue_occurrence', entryId, videoId, added: false, index, afterEntryId, beforeEntryId });

const addition = (entryId: string, videoId: string): Effect =>
  ({ kind: 'queue_occurrence', entryId, videoId, added: true, index: 0, afterEntryId: null, beforeEntryId: null });

describe('applyQueueUndo', () => {
  it('rebuilds [A,B,C] after removing B then A and undoing B then A', () => {
    let state = q(['q3', 'C']);
    state = applyQueueUndo(state, removal('q2', 'B', 1, 'q1', 'q3')) as QueueState;
    state = applyQueueUndo(state, removal('q1', 'A', 0, null, 'q3')) as QueueState;
    expect(state.items.map((i) => i.videoId)).toEqual(['A', 'B', 'C']);
  });

  it('restores a middle entry between its surviving neighbours', () => {
    const state = applyQueueUndo(q(['q1', 'A'], ['q3', 'C']), removal('q2', 'B', 1, 'q1', 'q3')) as QueueState;
    expect(state.items.map((i) => i.videoId)).toEqual(['A', 'B', 'C']);
  });

  it('restores a first entry to the front', () => {
    const state = applyQueueUndo(q(['q2', 'B']), removal('q1', 'A', 0, null, 'q2')) as QueueState;
    expect(state.items.map((i) => i.videoId)).toEqual(['A', 'B']);
  });

  it('falls back to the saved index when both anchors are gone', () => {
    const state = applyQueueUndo(q(['q1', 'A']), removal('q3', 'C', 2, 'q2', null)) as QueueState;
    expect(state.items.map((i) => i.videoId)).toEqual(['A', 'C']);
  });

  it('undoes an addition by removing that occurrence', () => {
    const state = applyQueueUndo(q(['q1', 'A'], ['q2', 'B']), addition('q1', 'A')) as QueueState;
    expect(state.items.map((i) => i.videoId)).toEqual(['B']);
  });

  it('returns null when nothing changed, so the caller refuses instead of claiming success', () => {
    // Already restored.
    expect(applyQueueUndo(q(['q2', 'B']), removal('q2', 'B', 0, null, null))).toBeNull();
    // Already gone.
    expect(applyQueueUndo(q(['q1', 'A']), addition('q9', 'Z'))).toBeNull();
  });

  it('restorePosition prefers the leading anchor, then the trailing one', () => {
    const items = [{ entryId: 'q1', videoId: 'A' }, { entryId: 'q3', videoId: 'C' }];
    expect(restorePosition(items, { afterEntryId: 'q1', beforeEntryId: 'q3', index: 99 })).toBe(1);
    expect(restorePosition(items, { afterEntryId: 'gone', beforeEntryId: 'q3', index: 99 })).toBe(1);
    expect(restorePosition(items, { afterEntryId: 'gone', beforeEntryId: 'gone', index: 1 })).toBe(1);
  });
});
