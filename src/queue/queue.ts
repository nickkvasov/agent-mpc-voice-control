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

export function add(
  q: QueueState,
  videoIds: readonly string[],
  position: 'next' | 'end' = 'end',
  confirmedCount?: number,
): ToolResult<QueueState> {
  if (videoIds.length === 0) {
    return refuse(REFUSAL_REASON.argumentsInvalid, 'No videos were given to queue.');
  }
  // A gate, not a prohibition: without this path a bulk add could never
  // succeed however clearly the person confirmed it (Gate C).
  if (videoIds.length > BULK_THRESHOLD && confirmedCount !== videoIds.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would add ${String(videoIds.length)} videos to the queue. Confirm that count to go ahead.`,
    );
  }
  const items = position === 'next' ? [...videoIds, ...q.items] : [...q.items, ...videoIds];
  return ok({ ...q, items });
}

export function remove(q: QueueState, videoIds: readonly string[], confirmedCount?: number): ToolResult<QueueState> {
  const affected = q.items.filter((id) => videoIds.includes(id)).length;
  if (affected === 0) {
    return refuse(
      REFUSAL_REASON.noSuchVideo,
      videoIds.length === 1 ? 'That video is not in the queue.' : 'None of those videos are in the queue.',
    );
  }
  // Removing many is as destructive as clearing, and was not gated at all.
  if (affected > BULK_THRESHOLD && confirmedCount !== affected) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would remove ${String(affected)} entries from the queue. Confirm that count to go ahead.`,
    );
  }
  const drop = new Set(videoIds);
  return ok({ ...q, items: q.items.filter((id) => !drop.has(id)) });
}

/**
 * Removes ONE scheduled play, by position.
 *
 * A queue may legitimately hold the same video twice, and each row has its own
 * Remove button — removing by id took both, cancelling a play the person had
 * not asked to cancel (Gate C).
 */
export function removeAt(q: QueueState, index: number): ToolResult<QueueState> {
  if (!Number.isInteger(index) || index < 0 || index >= q.items.length) {
    return refuse(
      REFUSAL_REASON.argumentsInvalid,
      `Position ${String(index)} is outside the queue, which holds ${String(q.items.length)}.`,
    );
  }
  const items = [...q.items];
  items.splice(index, 1);
  return ok({ ...q, items });
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
