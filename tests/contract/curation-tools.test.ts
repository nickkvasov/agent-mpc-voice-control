import { describe, expect, it, beforeEach } from 'vitest';
import {
  createCollection, renameCollection, addToCollection, removeFromCollection, deleteCollection,
  EMPTY_COLLECTIONS, __resetCollectionIds, type CollectionsState,
} from '../../src/curation/collections.ts';
import { setLabel, addTag, removeTag, displayName } from '../../src/curation/annotations.ts';
import { makeVideoReference } from '../../src/store/video-reference.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';

const vid = (id: string, over: { title?: string; label?: string | null; tags?: string[] } = {}) =>
  makeVideoReference({
    videoId: id, title: over.title ?? 'Source title', channelTitle: 'c', publishedAt: 0,
    label: over.label ?? null, tags: over.tags ?? [],
  });

function withCollection(name = 'Favourites'): { state: CollectionsState; id: string } {
  const r = createCollection(EMPTY_COLLECTIONS, name);
  if (!r.ok) throw new Error('setup failed');
  return { state: r.value.state, id: r.value.collection.collectionId };
}

describe('collections', () => {
  beforeEach(() => __resetCollectionIds());

  it('creates a collection', () => {
    const r = createCollection(EMPTY_COLLECTIONS, 'Favourites');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.collection.name).toBe('Favourites');
  });

  it('refuses a duplicate name rather than merging two collections', () => {
    const { state } = withCollection();
    for (const attempt of ['Favourites', 'favourites', '  FAVOURITES  ']) {
      const r = createCollection(state, attempt);
      expect(r.ok, attempt).toBe(false);
      if (!r.ok) expect(r.detail).toMatch(/already exists/);
    }
  });

  it('lets a collection change the case of its OWN name', () => {
    const { state, id } = withCollection('Favourites');
    const r = renameCollection(state, id, 'favourites');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.to).toBe('favourites'); expect(r.value.from).toBe('Favourites'); }
  });

  it("refuses a rename that collides with a DIFFERENT collection", () => {
    const first = withCollection('Favourites');
    const second = createCollection(first.state, 'Later');
    if (!second.ok) return;
    const r = renameCollection(second.value.state, second.value.collection.collectionId, 'FAVOURITES');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/different collection/);
  });

  it('adds videos and reports ones already present rather than silently succeeding', () => {
    const { state, id } = withCollection();
    const added = addToCollection(state, id, ['a', 'b']);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const again = addToCollection(added.value.state, id, ['a']);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.detail).toMatch(/already in/);
  });

  it('requires counted confirmation above the bulk threshold', () => {
    const { state, id } = withCollection();
    const ids = ['1', '2', '3', '4', '5', '6'];
    const gated = addToCollection(state, id, ids);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.reason).toBe(REFUSAL_REASON.needsConfirmation);
    expect(addToCollection(state, id, ids, 6).ok).toBe(true);
  });

  it('names its target and waits before removing (FR-026)', () => {
    const { state, id } = withCollection();
    const added = addToCollection(state, id, ['a']);
    if (!added.ok) return;
    const unconfirmed = removeFromCollection(added.value.state, id, ['a'], false);
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(unconfirmed.reason).toBe(REFUSAL_REASON.needsConfirmation);
      expect(unconfirmed.detail).toMatch(/Favourites/);
      expect(unconfirmed.detail).toMatch(/\ba\b/);
    }
    expect(removeFromCollection(added.value.state, id, ['a'], true).ok).toBe(true);
  });

  it('always requires the count to delete a collection, however small', () => {
    const { state, id } = withCollection();
    const added = addToCollection(state, id, ['a']);
    if (!added.ok) return;
    const nope = deleteCollection(added.value.state, id);
    expect(nope.ok).toBe(false);
    if (!nope.ok) expect(nope.detail).toMatch(/Favourites.*1 video/);
    expect(deleteCollection(added.value.state, id, 0).ok).toBe(false);
    expect(deleteCollection(added.value.state, id, 1).ok).toBe(true);
  });
});

describe('labels and tags', () => {
  it('sets a personal label and asserts the source title is untouched', () => {
    const r = setLabel(vid('aaaaaaaaaaa', { title: 'Original title' }), 'Q3 retro');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.label).toBe('Q3 retro');
      expect(r.value.sourceTitleUnchanged).toBe(true);
      expect(r.value.sourceTitle).toBe('Original title');
    }
  });

  it('refuses an empty label instead of making a nameless one', () => {
    const r = setLabel(vid('aaaaaaaaaaa'), '   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/Clear it instead/);
  });

  it('refuses a label that changes nothing', () => {
    expect(setLabel(vid('aaaaaaaaaaa', { label: 'Same' }), 'Same').ok).toBe(false);
    expect(setLabel(vid('aaaaaaaaaaa'), null).ok).toBe(false);
  });

  it('shows the personal label over the source title, and says which it is', () => {
    expect(displayName(vid('aaaaaaaaaaa', { title: 'Src' }))).toEqual({ shown: 'Src', isPersonal: false });
    expect(displayName(vid('aaaaaaaaaaa', { title: 'Src', label: 'Mine' }))).toEqual({ shown: 'Mine', isPersonal: true });
  });

  it('tags only the videos that lack the tag, and says which were already tagged', () => {
    const r = addTag([vid('aaaaaaaaaaa'), vid('bbbbbbbbbbb', { tags: ['onboarding'] })], 'Onboarding');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.changed).toEqual(['aaaaaaaaaaa']); expect(r.value.unchanged).toEqual(['bbbbbbbbbbb']); }
  });

  it('refuses when every video already has the tag', () => {
    const r = addTag([vid('aaaaaaaaaaa', { tags: ['x'] })], 'x');
    expect(r.ok).toBe(false);
  });

  it('requires counted confirmation to tag more than five', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => vid(c.repeat(11)));
    expect(addTag(many, 'bulk').ok).toBe(false);
    expect(addTag(many, 'bulk', 6).ok).toBe(true);
  });

  it('refuses to remove a tag nothing carries', () => {
    expect(removeTag([vid('aaaaaaaaaaa')], 'absent').ok).toBe(false);
  });
});
