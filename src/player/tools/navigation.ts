import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import { AVAILABILITY, type Availability } from '../../vocab/availability.ts';

export interface QueueItem {
  readonly videoId: string;
  readonly title: string;
  readonly availability: Availability;
}

export interface NavigationValue {
  readonly videoId: string;
  /** Items passed over, each with the specific reason (FR-036). */
  readonly skipped: readonly { videoId: string; reason: Availability }[];
}

const UNPLAYABLE: readonly Availability[] = [
  AVAILABILITY.removed, AVAILABILITY.private, AVAILABILITY.ageRestricted,
  AVAILABILITY.regionBlocked, AVAILABILITY.embeddingDisallowed,
];

/**
 * Moves through the queue, skipping what cannot play and stating why.
 * A skipped item is never silently dropped (FR-036, US2 acceptance 7).
 */
export function step(items: readonly QueueItem[], currentIndex: number, direction: 1 | -1): ToolResult<NavigationValue> {
  const skipped: { videoId: string; reason: Availability }[] = [];
  for (let i = currentIndex + direction; i >= 0 && i < items.length; i += direction) {
    const item = items[i] as QueueItem;
    if (UNPLAYABLE.includes(item.availability)) {
      skipped.push({ videoId: item.videoId, reason: item.availability });
      continue;
    }
    return ok({ videoId: item.videoId, skipped });
  }
  const where = direction === 1 ? 'after this one' : 'before this one';
  return refuse(
    REFUSAL_REASON.noSuchVideo,
    skipped.length === 0
      ? `There is nothing in the queue ${where}.`
      : `Nothing playable ${where}; skipped ${String(skipped.length)}: ${skipped.map((s) => `${s.videoId} (${s.reason})`).join(', ')}.`,
  );
}
