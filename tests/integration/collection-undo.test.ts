import { describe, expect, it, beforeEach } from 'vitest';
import { applyCollectionUndo } from '../../src/curation/restore.ts';
import {
  createCollection, addToCollection, deleteCollection, EMPTY_COLLECTIONS, __resetCollectionIds,
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
    const effect: Effect = { kind: 'collection_member', collectionId: id, videoId: 'a', added: true };
    const after = applyCollectionUndo(added.value.state, effect);
    expect(after?.items[0]?.videoIds).toEqual([]);
  });

  it('returns null when nothing changed, so the caller refuses', () => {
    const { state, id } = built();
    const effect: Effect = { kind: 'collection_member', collectionId: id, videoId: 'absent', added: true };
    expect(applyCollectionUndo(state, effect)).toBeNull();
  });

  it('does not add a video twice through one call', () => {
    const { state, id } = built();
    const r = addToCollection(state, id, ['aaaaaaaaaaa', 'aaaaaaaaaaa']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state.items[0]?.videoIds).toEqual(['aaaaaaaaaaa']);
  });
});
