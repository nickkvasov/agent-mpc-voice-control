import { describe, expect, it } from 'vitest';
import { resolveConfirmation, resolveCountedConfirmation } from '../../src/mcp/confirmation-resolver.ts';
import {
  createCollection, addToCollection, removeFromCollection, deleteCollection, EMPTY_COLLECTIONS, __resetCollectionIds,
} from '../../src/curation/collections.ts';

/**
 * T073/T074 — the resolver and the curation gates working together.
 *
 * Testing the gates alone would not show what matters: that an unclear spoken
 * response reaches them as a REFUSAL rather than as approval.
 */
function setup(videoIds: readonly string[]) {
  __resetCollectionIds();
  const created = createCollection(EMPTY_COLLECTIONS, 'Favourites');
  if (!created.ok) throw new Error('setup');
  const id = created.value.collection.collectionId;
  if (videoIds.length === 0) return { state: created.value.state, id };
  const added = addToCollection(created.value.state, id, videoIds, videoIds.length > 5 ? videoIds.length : undefined);
  if (!added.ok) throw new Error('setup');
  return { state: added.value.state, id };
}

describe('unclear confirmation abandons the action', () => {
  it('an unclear answer to "remove this?" does not remove it', () => {
    const { state, id } = setup(['a']);
    for (const response of ['maybe', 'i think so', 'sure why not', '', 'wait', null]) {
      const confirmed = resolveConfirmation(response) === 'confirmed';
      const r = removeFromCollection(state, id, ['a'], confirmed);
      expect(r.ok, String(response)).toBe(false);
    }
  });

  it('a clear yes does remove it', () => {
    const { state, id } = setup(['a']);
    const r = removeFromCollection(state, id, ['a'], resolveConfirmation('yes') === 'confirmed');
    expect(r.ok).toBe(true);
  });

  it('an affirmative WITHOUT the count does not delete a collection', () => {
    const { state, id } = setup(['a', 'b', 'c']);
    const confirmed = resolveCountedConfirmation('yes', 3) === 'confirmed';
    expect(confirmed).toBe(false);
    expect(deleteCollection(state, id, confirmed ? 3 : undefined).ok).toBe(false);
  });

  it('the count said back does delete it', () => {
    const { state, id } = setup(['a', 'b', 'c']);
    expect(resolveCountedConfirmation('yes, all 3', 3)).toBe('confirmed');
    expect(deleteCollection(state, id, 3).ok).toBe(true);
  });

  it('a WRONG count does not delete it', () => {
    const { state, id } = setup(['a', 'b', 'c']);
    expect(resolveCountedConfirmation('yes, all 4', 3)).toBe('refused');
    expect(deleteCollection(state, id, 4).ok).toBe(false);
  });

  it('agreement buried in a withdrawal does not authorise a bulk change', () => {
    const many = ['1', '2', '3', '4', '5', '6'];
    const { state, id } = setup([]);
    for (const response of ["yes but don't remove all 6", 'yes, maybe 6', 'no, not 6']) {
      expect(resolveCountedConfirmation(response, 6), response).toBe('refused');
      expect(addToCollection(state, id, many, undefined).ok).toBe(false);
    }
  });
});
