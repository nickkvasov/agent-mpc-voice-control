import type { RecordedCall } from './record-writer.ts';

/**
 * FR-032: a partially applied action records what WAS applied and what was not,
 * and is never recorded as a success.
 *
 * Separated out because getting this wrong is silent: an action that half
 * worked and is filed as "succeeded" leaves the person believing something that
 * did not happen, with no trace of the half that failed.
 */
export interface PartialOutcome<T> {
  readonly applied: readonly T[];
  readonly notApplied: readonly { readonly item: T; readonly reason: string }[];
}

export function classify<T>(outcome: PartialOutcome<T>): RecordedCall['result'] {
  if (outcome.notApplied.length === 0) return 'succeeded';
  if (outcome.applied.length === 0) return 'failed';
  return 'partially_applied';
}

export function detail<T>(outcome: PartialOutcome<T>, describe: (item: T) => string): string | null {
  if (outcome.notApplied.length === 0) return null;
  const failed = outcome.notApplied.map((n) => `${describe(n.item)} (${n.reason})`).join(', ');
  return outcome.applied.length === 0
    ? `None were applied: ${failed}.`
    : `Applied ${String(outcome.applied.length)}: ${outcome.applied.map(describe).join(', ')}. Not applied: ${failed}.`;
}
