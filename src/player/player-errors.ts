import { AVAILABILITY, type Availability } from '../vocab/availability.ts';
import { availabilityFromError, isOriginError } from './player.ts';

/**
 * A player error, in the words FR-036 requires: the specific reason, never a
 * generic failure. Error 153 is this page's origin, not a property of the
 * video (R4) — saying "unavailable" would send someone to debug the catalogue.
 */
export function describePlayerError(code: number): { readonly availability: Availability | null; readonly message: string } {
  if (isOriginError(code)) {
    return {
      availability: null,
      message: 'The player could not verify this page\'s origin (error 153). This is a problem with how the page is served, not with the video.',
    };
  }
  const availability = availabilityFromError(code);
  const reason: Readonly<Record<Availability, string>> = {
    [AVAILABILITY.removed]: 'YouTube reports this video was removed or does not exist.',
    [AVAILABILITY.embeddingDisallowed]: 'This video\'s owner does not allow it to be embedded, so it can only be watched on YouTube.',
    [AVAILABILITY.private]: 'This video is private.',
    [AVAILABILITY.ageRestricted]: 'This video is age-restricted and cannot be played here.',
    [AVAILABILITY.regionBlocked]: 'This video is not available in this region.',
    [AVAILABILITY.available]: `The player reported error ${String(code)}.`,
    [AVAILABILITY.unknown]: `The player reported error ${String(code)}, which does not say why the video cannot play.`,
  };
  return { availability, message: reason[availability] };
}
