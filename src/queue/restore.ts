import { invert } from '../activity/undo.ts';
import type { Effect } from '../activity/effects.ts';
import type { QueueEntry, QueueState } from './queue.ts';

/**
 * Applying an undo to the queue.
 *
 * Extracted from the React callback deliberately. While this lived inline, a
 * fix could be written, exported as a helper, unit-tested and still never
 * called by the application — which is exactly what happened: `restorePosition`
 * was tested for two rounds while `undoAction` kept using the stale index, and
 * the suite stayed green because the tests reached the helper rather than the
 * path (Gate C).
 *
 * Now the path IS the function, so breaking it turns the tests red.
 */
export function restorePosition(
  items: readonly QueueEntry[],
  anchors: { readonly afterEntryId: string | null; readonly beforeEntryId: string | null; readonly index: number },
): number {
  if (anchors.afterEntryId === null) return 0;
  const after = items.findIndex((e) => e.entryId === anchors.afterEntryId);
  if (after !== -1) return after + 1;
  // The leading anchor is gone too — when several entries were removed, the one
  // that FOLLOWED is what places this correctly.
  if (anchors.beforeEntryId !== null) {
    const before = items.findIndex((e) => e.entryId === anchors.beforeEntryId);
    if (before !== -1) return before;
  }
  return Math.min(Math.max(anchors.index, 0), items.length);
}

/**
 * Applies the inverse of a recorded effect to the queue.
 *
 * Returns the new state, or `null` when nothing changed — which the caller must
 * report as a refusal rather than a successful undo (Constitution III).
 */
export function applyQueueUndo(queue: QueueState, effect: Effect): QueueState | null {
  const inverse = invert(effect);
  if (inverse.kind !== 'queue_occurrence') return null;
  const items = [...queue.items];

  if (inverse.added) {
    if (items.some((e) => e.entryId === inverse.entryId)) return null;
    items.splice(restorePosition(items, inverse), 0, { entryId: inverse.entryId, videoId: inverse.videoId });
    return { ...queue, items };
  }

  const kept = items.filter((e) => e.entryId !== inverse.entryId);
  return kept.length === items.length ? null : { ...queue, items: kept };
}
