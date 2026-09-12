import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../mcp/result.ts';
import { eligibility, type EntryLike, type UndoEligibility } from './supersession.ts';
import type { Effect } from './effects.ts';

/**
 * Undo, guarded at execution.
 *
 * Eligibility is computed for display, and computed AGAIN here. Between a
 * button being rendered and being pressed, another command may have consumed the
 * effect — so a render-time check alone would offer an undo that has since
 * become a no-op. Codex's point at the consult, and the reason this revalidates
 * rather than trusting what the UI showed.
 *
 * An undo that changes nothing is reported as a refusal, never as success
 * (Constitution III).
 */
export interface UndoableEntry extends EntryLike {
  readonly entryId: string;
  readonly description: string;
}

export interface UndoApplication {
  /** Applies the inverse. Returns false when it found nothing to change. */
  apply(effect: Effect): boolean;
}

export interface UndoOutcome {
  readonly undoneEntryId: string;
  readonly description: string;
}

export function undoEntry(
  entry: UndoableEntry,
  allEntries: readonly EntryLike[],
  application: UndoApplication,
): ToolResult<UndoOutcome> {
  // Revalidated here, not trusted from the render.
  const current: UndoEligibility = eligibility(entry, allEntries);
  if (current.state === 'not_reversible') {
    return refuse(REFUSAL_REASON.notReversible, current.reason);
  }
  if (current.state === 'superseded') {
    return refuse(REFUSAL_REASON.superseded, `${current.reason} (superseded by action ${String(current.bySequence)})`);
  }
  if (current.state === 'unknown') {
    return refuse(REFUSAL_REASON.effectUnverifiable, current.reason);
  }
  if (entry.effect === null) {
    return refuse(REFUSAL_REASON.notReversible, 'This action recorded no effect to reverse.');
  }

  const changed = application.apply(entry.effect);
  if (!changed) {
    // The state moved between the check and the write. Reporting success here
    // would be the silent success this codebase is written against.
    return refuse(
      REFUSAL_REASON.effectUnverifiable,
      'Nothing changed when undoing this — the state it described is no longer there. The record is left as it was.',
    );
  }
  return ok({ undoneEntryId: entry.entryId, description: `Undid: ${entry.description}` });
}

/** The inverse of an effect, for applying an undo. */
export function invert(effect: Effect): Effect {
  switch (effect.kind) {
    case 'collection_member':
      return { ...effect, added: !effect.added };
    case 'collection_existence':
      return { ...effect, created: !effect.created };
    case 'queue_occurrence':
      return { ...effect, added: !effect.added };
    case 'tag':
      return { ...effect, added: !effect.added };
    case 'collection_name':
      return { ...effect, from: effect.to, to: effect.from };
    case 'label':
      return { ...effect, from: effect.to, to: effect.from };
  }
}
