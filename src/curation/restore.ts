import { invert } from '../activity/undo.ts';
import type { Effect } from '../activity/effects.ts';
import type { Collection, CollectionsState } from './collections.ts';

/**
 * Applying an undo to collections.
 *
 * A sibling of the queue's restore module, and for the same reason: while this
 * logic lives in a component callback a fix can be written, tested and never
 * called (NOTES.md 2026-09-13). Returns `null` when nothing changed, which the
 * caller reports as a refusal rather than a successful undo.
 *
 * Deletion carries the whole collection, because restoring it needs its
 * members and its name back, not just its id.
 */
export function applyCollectionUndo(
  state: CollectionsState,
  effect: Effect,
  deleted?: Collection,
): CollectionsState | null {
  const inverse = invert(effect);

  if (inverse.kind === 'collection_existence') {
    if (inverse.created) {
      if (deleted === undefined) return null;
      if (state.items.some((c) => c.collectionId === deleted.collectionId)) return null;
      return { items: [...state.items, deleted] };
    }
    const kept = state.items.filter((c) => c.collectionId !== inverse.collectionId);
    return kept.length === state.items.length ? null : { items: kept };
  }

  if (inverse.kind === 'collection_member') {
    const target = state.items.find((c) => c.collectionId === inverse.collectionId);
    if (target === undefined) return null;
    if (inverse.added) {
      if (target.videoIds.includes(inverse.videoId)) return null;
      return {
        items: state.items.map((c) =>
          c.collectionId === inverse.collectionId ? { ...c, videoIds: [...c.videoIds, inverse.videoId] } : c,
        ),
      };
    }
    if (!target.videoIds.includes(inverse.videoId)) return null;
    return {
      items: state.items.map((c) =>
        c.collectionId === inverse.collectionId
          ? { ...c, videoIds: c.videoIds.filter((id) => id !== inverse.videoId) }
          : c,
      ),
    };
  }

  if (inverse.kind === 'collection_name') {
    const target = state.items.find((c) => c.collectionId === inverse.collectionId);
    if (target === undefined || target.name === inverse.to) return null;
    return {
      items: state.items.map((c) => (c.collectionId === inverse.collectionId ? { ...c, name: inverse.to } : c)),
    };
  }

  return null;
}
