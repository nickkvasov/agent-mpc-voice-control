import { describe, expect, it } from 'vitest';
import { restorePosition } from '../../src/App.tsx';

/**
 * Gate C: with [A,B,C], removing B then A and undoing both rebuilt the queue as
 * [A,C,B], because a saved numeric index goes stale once anything before it
 * moves. Restoration anchors to the entry it FOLLOWED instead.
 */
interface Entry { entryId: string; videoId: string }

function neighbourBefore(items: readonly Entry[], entryId: string): string | null {
  const i = items.findIndex((e) => e.entryId === entryId);
  return i <= 0 ? null : (items[i - 1]?.entryId ?? null);
}

function neighbourAfter(items: readonly Entry[], entryId: string): string | null {
  const i = items.findIndex((e) => e.entryId === entryId);
  return i === -1 || i === items.length - 1 ? null : (items[i + 1]?.entryId ?? null);
}

/** Drives the PRODUCTION restorePosition, not a copy of it. */
function restore(items: Entry[], removed: Entry, anchors: { afterEntryId: string | null; beforeEntryId: string | null; index: number }): Entry[] {
  const out = [...items];
  out.splice(restorePosition(out, anchors), 0, removed);
  return out;
}

describe('queue restoration order', () => {
  const A = { entryId: 'q1', videoId: 'A' };
  const B = { entryId: 'q2', videoId: 'B' };
  const C = { entryId: 'q3', videoId: 'C' };

  it('restores [A,B,C] after removing B then A and undoing both', () => {
    let items: Entry[] = [A, B, C];
    const bAnchors = { afterEntryId: neighbourBefore(items, 'q2'), beforeEntryId: neighbourAfter(items, 'q2'), index: 1 };
    items = items.filter((e) => e.entryId !== 'q2');
    const aAnchors = { afterEntryId: neighbourBefore(items, 'q1'), beforeEntryId: neighbourAfter(items, 'q1'), index: 0 };
    items = items.filter((e) => e.entryId !== 'q1');
    expect(items.map((e) => e.videoId)).toEqual(['C']);

    items = restore(items, B, bAnchors);
    items = restore(items, A, aAnchors);
    expect(items.map((e) => e.videoId)).toEqual(['A', 'B', 'C']);
  });

  it('restores a first entry to the front', () => {
    let items: Entry[] = [A, B];
    const anchors = { afterEntryId: neighbourBefore(items, 'q1'), beforeEntryId: neighbourAfter(items, 'q1'), index: 0 };
    expect(anchors.afterEntryId).toBeNull();
    items = items.filter((e) => e.entryId !== 'q1');
    expect(restore(items, A, anchors).map((e) => e.videoId)).toEqual(['A', 'B']);
  });

  it('falls back to the saved index when the anchor is gone too', () => {
    let items: Entry[] = [A, B, C];
    const anchors = { afterEntryId: neighbourBefore(items, 'q3'), beforeEntryId: neighbourAfter(items, 'q3'), index: 2 };
    items = items.filter((e) => e.entryId !== 'q3' && e.entryId !== 'q2');
    expect(restore(items, C, anchors).map((e) => e.videoId)).toEqual(['A', 'C']);
  });
});
