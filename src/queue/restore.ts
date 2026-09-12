import { invert } from '../activity/undo.ts';
import type { Effect } from '../activity/effects.ts';
import { sorted, type QueueState } from './queue.ts';

/**
 * Applying an undo to the queue.
 *
 * Extracted from the React callback deliberately. While it lived inline, a fix
 * could be written, exported as a helper, unit-tested and still never called —
 * which happened for two Gate C rounds (NOTES.md 2026-09-13). The path IS this
 * function now, so breaking it turns tests red.
 *
 * Restoration puts the entry's original sort key back and re-sorts. No
 * neighbour anchors, no saved index: both broke when several entries were
 * removed and restored in an order other than the one they were removed in.
 */
export function applyQueueUndo(queue: QueueState, effect: Effect): QueueState | null {
  const inverse = invert(effect);
  if (inverse.kind !== 'queue_occurrence') return null;

  if (inverse.added) {
    if (queue.items.some((e) => e.entryId === inverse.entryId)) return null;
    const restored = { entryId: inverse.entryId, videoId: inverse.videoId, order: inverse.order };
    return { ...queue, items: sorted([...queue.items, restored]) };
  }

  const kept = queue.items.filter((e) => e.entryId !== inverse.entryId);
  return kept.length === queue.items.length ? null : { ...queue, items: kept };
}
