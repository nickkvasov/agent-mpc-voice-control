import { containerOf, identityOf, type Effect } from './effects.ts';

/**
 * Whether an entry can still be undone, given everything that happened after it.
 *
 * Codex's rule, adopted at the consult: a later action blocks undo when it
 * overwrites or consumes the earlier effect, destroys an identity the inverse
 * needs, or establishes a still-effective state the inverse would violate.
 *
 * Four outcomes, not three. Where eligibility cannot be established the answer
 * is `unknown` with a reason and no button — an undo offered on a guess is
 * exactly the silent wrong action this whole record exists to prevent.
 */
export type UndoEligibility =
  | { readonly state: 'undoable' }
  | { readonly state: 'not_reversible'; readonly reason: string }
  | { readonly state: 'superseded'; readonly bySequence: number; readonly reason: string }
  | { readonly state: 'unknown'; readonly reason: string };

export interface EntryLike {
  readonly sequence: number;
  readonly effect: Effect | null;
  readonly result: 'succeeded' | 'failed' | 'partially_applied';
  readonly undone: boolean;
}

export function eligibility(entry: EntryLike, later: readonly EntryLike[]): UndoEligibility {
  if (entry.result === 'failed') {
    return { state: 'not_reversible', reason: 'This action did not take effect, so there is nothing to undo.' };
  }
  if (entry.result === 'partially_applied') {
    // Honest: we recorded that part of it landed, but not precisely which part.
    return {
      state: 'unknown',
      reason: 'This action was only partly applied, so what undoing it would restore is not established.',
    };
  }
  if (entry.undone) {
    return { state: 'not_reversible', reason: 'This action has already been undone.' };
  }
  if (entry.effect === null) {
    // Deliberately says nothing about WHAT kind of action this was. The earlier
    // wording offered "a search, for example" on every entry, so a playback
    // command was explained as a search — a message that describes a different
    // action than the one it sits under (Gate B).
    return { state: 'not_reversible', reason: 'Nothing to put back: this action changed no stored state.' };
  }

  const id = identityOf(entry.effect);
  const container = containerOf(entry.effect);

  for (const l of later) {
    // An action that was itself undone no longer blocks anything. Without this
    // the record kept saying a video "was removed by a later action" after that
    // removal had been reversed, and hid an Undo that would now work (Gate C).
    if (l.sequence <= entry.sequence || l.effect === null || l.result === 'failed' || l.undone) continue;

    // (2) The identity the inverse needs was destroyed.
    if (container !== null && l.effect.kind === 'collection_existence' && !l.effect.created && `collection:${l.effect.collectionId}` === container) {
      return {
        state: 'superseded',
        bySequence: l.sequence,
        reason: 'Unavailable: the collection this belonged to was deleted later.',
      };
    }

    if (identityOf(l.effect) !== id) continue;

    // (1) The effect was consumed — undoing would be a no-op.
    if (entry.effect.kind === 'collection_member' && l.effect.kind === 'collection_member' && l.effect.added !== entry.effect.added) {
      return {
        state: 'superseded',
        bySequence: l.sequence,
        reason: 'The effect was already reversed by a later action, so undoing it would change nothing.',
      };
    }
    if (entry.effect.kind === 'queue_occurrence' && l.effect.kind === 'queue_occurrence' && l.effect.added !== entry.effect.added) {
      return {
        state: 'superseded',
        bySequence: l.sequence,
        reason: 'That queued play was already removed by a later action.',
      };
    }
    if (entry.effect.kind === 'tag' && l.effect.kind === 'tag' && l.effect.added !== entry.effect.added) {
      return {
        state: 'superseded',
        bySequence: l.sequence,
        reason: 'That tag was already changed back by a later action.',
      };
    }

    // (3) A later action set a value that is still in force; restoring the old
    //     one would overwrite it.
    if (entry.effect.kind === 'collection_name' && l.effect.kind === 'collection_name') {
      return {
        state: 'superseded',
        bySequence: l.sequence,
        reason: 'Superseded: the name was changed again later, and restoring the old one would overwrite it.',
      };
    }
    if (entry.effect.kind === 'label' && l.effect.kind === 'label') {
      return {
        state: 'superseded',
        bySequence: l.sequence,
        reason: 'Superseded: the label was changed again later, and restoring the old one would overwrite it.',
      };
    }
  }

  return { state: 'undoable' };
}
