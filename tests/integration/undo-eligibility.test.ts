import { describe, expect, it } from 'vitest';
import { eligibility, type EntryLike } from '../../src/activity/supersession.ts';
import type { Effect } from '../../src/activity/effects.ts';

/**
 * The five cases settled at the codex consult (NOTES.md 2026-09-12). These are
 * the rule, written down where they can fail.
 */
const entry = (sequence: number, effect: Effect | null, over: Partial<EntryLike> = {}): EntryLike => ({
  sequence,
  effect,
  result: 'succeeded',
  undone: false,
  ...over,
});

const addXtoC = entry(1, { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: true });

describe('undo eligibility', () => {
  it('case 1: add X then add Y — X is still undoable', () => {
    const addY = entry(2, { kind: 'collection_member', collectionId: 'C', videoId: 'Y', added: true });
    expect(eligibility(addXtoC, [addY]).state).toBe('undoable');
  });

  it('case 2: add X then remove X — blocked, undoing would be a no-op', () => {
    const removeX = entry(2, { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: false });
    const e = eligibility(addXtoC, [removeX]);
    expect(e.state).toBe('superseded');
    if (e.state === 'superseded') { expect(e.bySequence).toBe(2); expect(e.reason).toMatch(/would change nothing/); }
  });

  it('case 3: rename C to D then D to E — blocked, restoring would overwrite', () => {
    const first = entry(1, { kind: 'collection_name', collectionId: 'C', from: 'C', to: 'D' });
    const second = entry(2, { kind: 'collection_name', collectionId: 'C', from: 'D', to: 'E' });
    const e = eligibility(first, [second]);
    expect(e.state).toBe('superseded');
    if (e.state === 'superseded') expect(e.reason).toMatch(/overwrite/);
  });

  it('case 4: add X then delete the collection — blocked, the identity is gone', () => {
    const del = entry(2, { kind: 'collection_existence', collectionId: 'C', created: false });
    const e = eligibility(addXtoC, [del]);
    expect(e.state).toBe('superseded');
    if (e.state === 'superseded') expect(e.reason).toMatch(/collection this belonged to was deleted/);
  });

  it('case 5: queue X then clear the queue — blocked', () => {
    const queued = entry(1, { kind: 'queue_occurrence', entryId: 'q1', added: true, videoId: 'X', index: 0, afterEntryId: null, beforeEntryId: null });
    const cleared = entry(2, { kind: 'queue_occurrence', entryId: 'q1', added: false, videoId: 'X', index: 0, afterEntryId: null, beforeEntryId: null });
    expect(eligibility(queued, [cleared]).state).toBe('superseded');
  });

  it('deleting a DIFFERENT collection does not block it', () => {
    const del = entry(2, { kind: 'collection_existence', collectionId: 'OTHER', created: false });
    expect(eligibility(addXtoC, [del]).state).toBe('undoable');
  });

  it('a failed later action blocks nothing — it did not happen', () => {
    const failedRemove = entry(2, { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: false }, { result: 'failed' });
    expect(eligibility(addXtoC, [failedRemove]).state).toBe('undoable');
  });

  it('a refused entry is not reversible, because it never took effect', () => {
    const e = eligibility(entry(1, null, { result: 'failed' }), []);
    expect(e.state).toBe('not_reversible');
  });

  it('an entry with no effect, such as a search, is not reversible', () => {
    expect(eligibility(entry(1, null), []).state).toBe('not_reversible');
  });

  it('an already undone entry is not offered again', () => {
    expect(eligibility({ ...addXtoC, undone: true }, []).state).toBe('not_reversible');
  });

  it('a partially applied action reports UNKNOWN rather than guessing', () => {
    const e = eligibility({ ...addXtoC, result: 'partially_applied' }, []);
    expect(e.state).toBe('unknown');
    if (e.state === 'unknown') expect(e.reason).toMatch(/not established/);
  });

  it('two independent tags on the same video do not block each other', () => {
    const tagA = entry(1, { kind: 'tag', videoId: 'X', tag: 'a', added: true });
    const tagB = entry(2, { kind: 'tag', videoId: 'X', tag: 'b', added: true });
    expect(eligibility(tagA, [tagB]).state).toBe('undoable');
  });
});

describe('Gate C round 2: an undone blocker stops blocking', () => {
  const addX = entry(1, { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: true });

  it('a removal that was itself undone no longer supersedes the addition', () => {
    const removal = entry(2, { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: false });
    // While the removal stands, the addition is superseded.
    expect(eligibility(addX, [removal]).state).toBe('superseded');
    // Once that removal is undone, the addition is undoable again — and the
    // record must stop saying X "was removed by a later action".
    expect(eligibility(addX, [{ ...removal, undone: true }]).state).toBe('undoable');
  });

  it('a still-standing later rename keeps blocking', () => {
    const first = entry(1, { kind: 'collection_name', collectionId: 'C', from: 'C', to: 'D' });
    const second = entry(2, { kind: 'collection_name', collectionId: 'C', from: 'D', to: 'E' });
    expect(eligibility(first, [second]).state).toBe('superseded');
    expect(eligibility(first, [{ ...second, undone: true }]).state).toBe('undoable');
  });
});
