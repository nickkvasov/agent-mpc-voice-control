/**
 * Why a tool call did not do what was asked.
 *
 * One closed set with the type and the membership test derived from it, per the
 * constitution's named-vocabularies rule. A refusal reason is never a bare
 * string literal and never an `as` cast of something received.
 */
export const REFUSAL_REASON = {
  notPlaying: 'not_playing',
  noSuchVideo: 'no_such_video',
  ambiguousReference: 'ambiguous_reference',
  unavailableVideo: 'unavailable_video',
  refusedByPlayer: 'refused_by_player',
  adInProgress: 'ad_in_progress',
  capabilityUnsupported: 'capability_unsupported',
  quotaExhausted: 'quota_exhausted',
  viewNotOpen: 'view_not_open',
  needsConfirmation: 'needs_confirmation',
  notReversible: 'not_reversible',
  superseded: 'superseded',
  /** The call never reached a handler: its arguments failed the declared schema. */
  argumentsInvalid: 'arguments_invalid',
  /** The effect could not be read back, so no success may be claimed. See T037. */
  effectUnverifiable: 'effect_unverifiable',
} as const;

export type RefusalReason = (typeof REFUSAL_REASON)[keyof typeof REFUSAL_REASON];

const MEMBERS: ReadonlySet<string> = new Set(Object.values(REFUSAL_REASON));

export function isRefusalReason(value: unknown): value is RefusalReason {
  return typeof value === 'string' && MEMBERS.has(value);
}
