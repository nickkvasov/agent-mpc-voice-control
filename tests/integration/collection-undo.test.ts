import { describe, expect, it, beforeEach } from 'vitest';
import { applyCollectionUndo } from '../../src/curation/restore.ts';
import {
  createCollection, addToCollection, removeFromCollection, deleteCollection, EMPTY_COLLECTIONS, __resetCollectionIds,
} from '../../src/curation/collections.ts';
import type { Effect } from '../../src/activity/effects.ts';

/** Drives the function the Undo handler calls for collection effects. */
describe('collection undo', () => {
  beforeEach(() => __resetCollectionIds());

  const built = () => {
    const c = createCollection(EMPTY_COLLECTIONS, 'Favourites');
    if (!c.ok) throw new Error('setup');
    return { state: c.value.state, id: c.value.collection.collectionId, collection: c.value.collection };
  };

  it('undoes a creation by removing the collection', () => {
    const { state, id } = built();
    const effect: Effect = { kind: 'collection_existence', collectionId: id, created: true };
    const after = applyCollectionUndo(state, effect);
    expect(after?.items).toHaveLength(0);
  });

  it('undoes a deletion by restoring the collection whole', () => {
    const { state, id } = built();
    const withVideos = addToCollection(state, id, ['a', 'b']);
    if (!withVideos.ok) return;
    const removed = deleteCollection(withVideos.value.state, id, 2);
    if (!removed.ok) return;
    expect(removed.value.state.items).toHaveLength(0);
    const effect: Effect = { kind: 'collection_existence', collectionId: id, created: false };
    const back = applyCollectionUndo(removed.value.state, effect, removed.value.deleted);
    expect(back?.items[0]?.name).toBe('Favourites');
    expect(back?.items[0]?.videoIds).toEqual(['a', 'b']);
  });

  it('refuses to restore a deletion with nothing to restore from', () => {
    const effect: Effect = { kind: 'collection_existence', collectionId: 'c9', created: false };
    expect(applyCollectionUndo(EMPTY_COLLECTIONS, effect)).toBeNull();
  });

  it('undoes a membership addition', () => {
    const { state, id } = built();
    const added = addToCollection(state, id, ['a']);
    if (!added.ok) return;
    const effect: Effect = { kind: 'collection_member', collectionId: id, videoId: 'a', added: true, index: 0 };
    const after = applyCollectionUndo(added.value.state, effect);
    expect(after?.items[0]?.videoIds).toEqual([]);
  });

  it('returns null when nothing changed, so the caller refuses', () => {
    const { state, id } = built();
    const effect: Effect = { kind: 'collection_member', collectionId: id, videoId: 'absent', added: true, index: 0 };
    expect(applyCollectionUndo(state, effect)).toBeNull();
  });

  it('does not add a video twice through one call', () => {
    const { state, id } = built();
    const r = addToCollection(state, id, ['aaaaaaaaaaa', 'aaaaaaaaaaa']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state.items[0]?.videoIds).toEqual(['aaaaaaaaaaa']);
  });
});

describe('Gate C round 2 regressions', () => {
  beforeEach(() => __resetCollectionIds());

  it('restores a removed member to its original position, not the end', () => {
    const c = createCollection(EMPTY_COLLECTIONS, 'Favourites');
    if (!c.ok) return;
    const id = c.value.collection.collectionId;
    const filled = addToCollection(c.value.state, id, ['a', 'b', 'c']);
    if (!filled.ok) return;
    const removed = removeFromCollection(filled.value.state, id, ['a'], true);
    if (!removed.ok) return;
    expect(removed.value.state.items[0]?.videoIds).toEqual(['b', 'c']);
    const back = applyCollectionUndo(removed.value.state, {
      kind: 'collection_member', collectionId: id, videoId: 'a', added: false, index: 0,
    });
    expect(back?.items[0]?.videoIds).toEqual(['a', 'b', 'c']);
  });

  it('refuses to restore a deleted collection whose name has been taken', () => {
    const first = createCollection(EMPTY_COLLECTIONS, 'Favourites');
    if (!first.ok) return;
    const id = first.value.collection.collectionId;
    const gone = deleteCollection(first.value.state, id, 0);
    if (!gone.ok) return;
    const replacement = createCollection(gone.value.state, 'favourites');
    if (!replacement.ok) return;
    // Restoring would produce two collections called Favourites.
    const attempt = applyCollectionUndo(
      replacement.value.state,
      { kind: 'collection_existence', collectionId: id, created: false },
      gone.value.deleted,
    );
    expect(attempt).toBeNull();
  });

  it('still restores it when the name is free', () => {
    const first = createCollection(EMPTY_COLLECTIONS, 'Favourites');
    if (!first.ok) return;
    const id = first.value.collection.collectionId;
    const gone = deleteCollection(first.value.state, id, 0);
    if (!gone.ok) return;
    const back = applyCollectionUndo(
      gone.value.state,
      { kind: 'collection_existence', collectionId: id, created: false },
      gone.value.deleted,
    );
    expect(back?.items[0]?.name).toBe('Favourites');
  });
});
