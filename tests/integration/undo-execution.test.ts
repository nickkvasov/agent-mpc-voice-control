import { describe, expect, it, vi } from 'vitest';
import { undoEntry, invert, type UndoableEntry } from '../../src/activity/undo.ts';
import { describeRecent, undoLabel, type DescribableEntry } from '../../src/activity/describe.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';
import type { Effect } from '../../src/activity/effects.ts';

const addX: Effect = { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: true };

const entry = (over: Partial<UndoableEntry> = {}): UndoableEntry => ({
  entryId: 'e1',
  sequence: 1,
  effect: addX,
  result: 'succeeded',
  undone: false,
  description: 'Added X to Favourites',
  ...over,
});

describe('undo execution', () => {
  it('applies the inverse and reports what it undid', () => {
    const apply = vi.fn(() => true);
    const r = undoEntry(entry(), [entry()], { apply });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toMatch(/Undid: Added X/);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('refuses rather than reporting success when nothing changed', () => {
    // The state moved between the check and the write.
    const r = undoEntry(entry(), [entry()], { apply: () => false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(REFUSAL_REASON.effectUnverifiable);
      expect(r.detail).toMatch(/no longer there/);
    }
  });

  it('revalidates at execution, not only at render', () => {
    // Eligible when rendered; a later removal arrived before the press.
    const later = { sequence: 2, effect: { ...addX, added: false }, result: 'succeeded' as const, undone: false };
    const apply = vi.fn(() => true);
    const r = undoEntry(entry(), [entry(), later], { apply });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.superseded);
    // Crucially, it never touched the application.
    expect(apply).not.toHaveBeenCalled();
  });

  it('names the superseding action', () => {
    const later = { sequence: 7, effect: { ...addX, added: false }, result: 'succeeded' as const, undone: false };
    const r = undoEntry(entry(), [entry(), later], { apply: () => true });
    if (!r.ok) expect(r.detail).toMatch(/superseded by action 7/);
  });

  it('refuses an already undone entry', () => {
    const r = undoEntry(entry({ undone: true }), [], { apply: () => true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.notReversible);
  });

  it('inverts every effect kind', () => {
    expect(invert(addX)).toMatchObject({ added: false });
    expect(invert({ kind: 'collection_name', collectionId: 'C', from: 'C', to: 'D' })).toMatchObject({ from: 'D', to: 'C' });
    expect(invert({ kind: 'label', videoId: 'X', from: null, to: 'Q3' })).toMatchObject({ from: 'Q3', to: null });
    expect(invert({ kind: 'queue_occurrence', entryId: 'q1', added: true, videoId: 'X', index: 0 })).toMatchObject({ added: false });
  });
});

describe('answering from the record (FR-033)', () => {
  const d = (over: Partial<DescribableEntry>): DescribableEntry => ({
    entryId: 'e', sequence: 1, effect: null, result: 'succeeded', undone: false,
    description: 'Did a thing', failureDetail: null, at: 0, ...over,
  });

  it('says so when nothing has happened', () => {
    expect(describeRecent([])).toMatch(/not done anything/);
  });

  it('reports refusals with their reason, not as successes', () => {
    const out = describeRecent([d({ result: 'failed', description: 'Paused playback', failureDetail: 'nothing was playing' })]);
    expect(out).toMatch(/refused: nothing was playing/);
  });

  it('marks entries that were later undone', () => {
    const out = describeRecent([d({ undone: true, description: 'Added X' })]);
    expect(out).toMatch(/since undone/);
  });

  it('lists most recent first', () => {
    const out = describeRecent([d({ sequence: 1, description: 'First' }), d({ sequence: 2, description: 'Second' })]);
    expect(out.indexOf('Second')).toBeLessThan(out.indexOf('First'));
  });

  it('labels an unknown eligibility as unknown rather than offering undo', () => {
    const partial = d({ result: 'partially_applied', effect: addX });
    expect(undoLabel(partial, [partial])).toMatch(/^Undo availability unknown/);
  });
});

describe('Gate C regressions', () => {
  const qEffect = (added: boolean): Effect => ({ kind: 'queue_occurrence', entryId: 'q1', added, videoId: 'X', index: 1 });

  it('a removal carries enough to put the entry back', () => {
    const inv = invert(qEffect(false));
    expect(inv).toMatchObject({ added: true, videoId: 'X', index: 1 });
  });

  it('names the blocking entry, not just "a later action"', () => {
    const first: DescribableEntry = {
      entryId: 'e1', sequence: 1, effect: { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: true },
      result: 'succeeded', undone: false, description: 'Added X to Favourites', failureDetail: null, at: 0,
    };
    const blocker: DescribableEntry = {
      entryId: 'e2', sequence: 2, effect: { kind: 'collection_member', collectionId: 'C', videoId: 'X', added: false },
      result: 'succeeded', undone: false, description: 'Removed X from Favourites', failureDetail: null, at: 0,
    };
    expect(undoLabel(first, [first, blocker])).toMatch(/blocked by: Removed X from Favourites/);
  });
});
