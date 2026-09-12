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
function nameTaken(state: CollectionsState, name: string, exceptId: string): boolean {
  return state.items.some(
    (c) => c.collectionId !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
}

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
      // Delete "Favourites", create a new "Favourites", undo the deletion: this
      // used to restore the old one beside the new one, producing two
      // collections with the same name — the uniqueness createCollection
      // enforces, bypassed through the back door (Gate C).
      if (nameTaken(state, deleted.name, deleted.collectionId)) return null;
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
      // Back where it was, not on the end.
      const at = Math.min(Math.max(inverse.index, 0), target.videoIds.length);
      const restored = [...target.videoIds];
      restored.splice(at, 0, inverse.videoId);
      return {
        items: state.items.map((c) => (c.collectionId === inverse.collectionId ? { ...c, videoIds: restored } : c)),
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
