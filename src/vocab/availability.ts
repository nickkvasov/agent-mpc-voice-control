/**
 * Why a video cannot be played, distinguished rather than collapsed.
 *
 * FR-036 requires the specific reason, never a generic failure. `unknown` is a
 * member on purpose: a reference whose availability has not been established is
 * not the same as one known to be fine (Constitution IV).
 */
export const AVAILABILITY = {
  available: 'available',
  removed: 'removed',
  private: 'private',
  ageRestricted: 'age_restricted',
  regionBlocked: 'region_blocked',
  embeddingDisallowed: 'embedding_disallowed',
  unknown: 'unknown',
} as const;

export type Availability = (typeof AVAILABILITY)[keyof typeof AVAILABILITY];

const MEMBERS: ReadonlySet<string> = new Set(Object.values(AVAILABILITY));

export function isAvailability(value: unknown): value is Availability {
  return typeof value === 'string' && MEMBERS.has(value);
}

/**
 * IFrame Player API error codes, mapped to the reasons FR-036 must report.
 * Measured in the T007 spike: 153 is a missing HTTP Referer, which is an
 * origin problem and NOT a property of the video — see NOTES.md.
 */
export const PLAYER_ERROR_TO_AVAILABILITY: Readonly<Record<number, Availability>> = {
  2: AVAILABILITY.unknown,
  5: AVAILABILITY.unknown,
  100: AVAILABILITY.removed,
  101: AVAILABILITY.embeddingDisallowed,
  150: AVAILABILITY.embeddingDisallowed,
};
