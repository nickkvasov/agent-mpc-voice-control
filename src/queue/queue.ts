import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../mcp/result.ts';
import { BULK_THRESHOLD } from '../vocab/tool-names.ts';

/**
 * The queue.
 *
 * Unlike a collection, a video may legitimately appear twice — watching
 * something again is not a duplicate to be deduplicated away.
 */
export interface QueueState {
  readonly items: readonly string[];
  readonly currentVideoId: string | null;
}

export const EMPTY_QUEUE: QueueState = { items: [], currentVideoId: null };

export function add(q: QueueState, videoIds: readonly string[], position: 'next' | 'end' = 'end'): ToolResult<QueueState> {
  if (videoIds.length === 0) {
    return refuse(REFUSAL_REASON.argumentsInvalid, 'No videos were given to queue.');
  }
  if (videoIds.length > BULK_THRESHOLD) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would add ${String(videoIds.length)} videos to the queue. Confirm the count to go ahead.`,
    );
  }
  const items = position === 'next' ? [...videoIds, ...q.items] : [...q.items, ...videoIds];
  return ok({ ...q, items });
}

export function remove(q: QueueState, videoIds: readonly string[]): ToolResult<QueueState> {
  const present = videoIds.filter((id) => q.items.includes(id));
  if (present.length === 0) {
    return refuse(
      REFUSAL_REASON.noSuchVideo,
      videoIds.length === 1 ? 'That video is not in the queue.' : 'None of those videos are in the queue.',
    );
  }
  const drop = new Set(present);
  return ok({ ...q, items: q.items.filter((id) => !drop.has(id)) });
}

export function reorder(q: QueueState, videoId: string, toIndex: number): ToolResult<QueueState> {
  const from = q.items.indexOf(videoId);
  if (from === -1) return refuse(REFUSAL_REASON.noSuchVideo, 'That video is not in the queue.');
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= q.items.length) {
    return refuse(
      REFUSAL_REASON.argumentsInvalid,
      `Position ${String(toIndex)} is outside the queue, which holds ${String(q.items.length)}.`,
    );
  }
  const items = [...q.items];
  const [moved] = items.splice(from, 1);
  items.splice(toIndex, 0, moved as string);
  return ok({ ...q, items });
}

/** Clearing is destructive to what the person built, so above the threshold it confirms. */
export function clear(q: QueueState, confirmedCount?: number): ToolResult<QueueState> {
  if (q.items.length === 0) {
    return refuse(REFUSAL_REASON.noSuchVideo, 'The queue is already empty.');
  }
  if (q.items.length > BULK_THRESHOLD && confirmedCount !== q.items.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `The queue holds ${String(q.items.length)} videos. Confirm that count to clear it.`,
    );
  }
  return ok({ ...q, items: [] });
}
