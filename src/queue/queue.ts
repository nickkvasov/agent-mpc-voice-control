import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../mcp/result.ts';
import { BULK_THRESHOLD } from '../vocab/tool-names.ts';

/**
 * The queue.
 *
 * A video may legitimately appear twice — watching something again is not a
 * duplicate to be deduplicated away. Each scheduled play therefore carries its
 * own **entryId**, and every mutation targets that rather than a video id or a
 * position.
 *
 * Positions are not identity. Binding a Remove button to index 0 and applying
 * it after the queue changed deleted whatever had moved into that slot, while
 * the outcome and the activity entry both named the video the person had
 * actually clicked (Gate C). An entryId cannot drift.
 */
export interface QueueEntry {
  readonly entryId: string;
  readonly videoId: string;
  /**
   * A stable sort key that never changes once assigned.
   *
   * Position is not identity, and neither are neighbours. Restoring by
   * "insert after the entry it followed" broke as soon as two removed entries
   * shared an anchor: with [A,B,C,D], removing C, D, A and undoing in that
   * order put D before C, because both recorded B as their predecessor
   * (Gate C). A key the entry keeps makes the restored order independent of the
   * order the undos happen in.
   */
  readonly order: number;
}

export interface QueueState {
  readonly items: readonly QueueEntry[];
  readonly currentVideoId: string | null;
}

export const EMPTY_QUEUE: QueueState = { items: [], currentVideoId: null };

let seq = 0;
export function newEntry(videoId: string, order?: number): QueueEntry {
  seq += 1;
  return { entryId: `q${String(seq)}`, videoId, order: order ?? seq };
}

export function __resetQueueIds(): void {
  seq = 0;
}

/** Keeps the list in key order; the only place ordering is decided. */
export function sorted(items: readonly QueueEntry[]): readonly QueueEntry[] {
  return [...items].sort((a, b) => a.order - b.order);
}

function lowestOrder(items: readonly QueueEntry[]): number {
  return items.reduce((m, e) => Math.min(m, e.order), Number.POSITIVE_INFINITY);
}

export function add(
  q: QueueState,
  videoIds: readonly string[],
  position: 'next' | 'end' = 'end',
  confirmedCount?: number,
): ToolResult<QueueState> {
  if (videoIds.length === 0) {
    return refuse(REFUSAL_REASON.argumentsInvalid, 'No videos were given to queue.');
  }
  // A gate, not a prohibition: without this path a bulk add could never succeed
  // however clearly the person confirmed it.
  if (videoIds.length > BULK_THRESHOLD && confirmedCount !== videoIds.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would add ${String(videoIds.length)} videos to the queue. Confirm that count to go ahead.`,
    );
  }
  // 'next' needs keys below everything present; midpoints keep them distinct
  // without renumbering anything that already exists.
  const base = position === 'next' ? lowestOrder(q.items) : Number.NaN;
  const entries = videoIds.map((id, i) =>
    position === 'next' && Number.isFinite(base)
      ? newEntry(id, base - (videoIds.length - i) / (videoIds.length + 1))
      : newEntry(id),
  );
  return ok({ ...q, items: sorted([...q.items, ...entries]) });
}

/** Removes specific scheduled plays, named by entryId. */
export function removeEntries(q: QueueState, entryIds: readonly string[], confirmedCount?: number): ToolResult<QueueState> {
  const targets = new Set(entryIds);
  const affected = q.items.filter((e) => targets.has(e.entryId));
  if (affected.length === 0) {
    return refuse(
      REFUSAL_REASON.noSuchVideo,
      entryIds.length === 1
        ? 'That entry is no longer in the queue — it may have been removed already.'
        : 'None of those entries are in the queue any more.',
    );
  }
  if (affected.length > BULK_THRESHOLD && confirmedCount !== affected.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would remove ${String(affected.length)} entries from the queue. Confirm that count to go ahead.`,
    );
  }
  return ok({ ...q, items: q.items.filter((e) => !targets.has(e.entryId)) });
}

/** Removes every scheduled play of a video. Distinct from removing one. */
export function removeVideo(q: QueueState, videoIds: readonly string[], confirmedCount?: number): ToolResult<QueueState> {
  const wanted = new Set(videoIds);
  const affected = q.items.filter((e) => wanted.has(e.videoId));
  if (affected.length === 0) {
    return refuse(
      REFUSAL_REASON.noSuchVideo,
      videoIds.length === 1 ? 'That video is not in the queue.' : 'None of those videos are in the queue.',
    );
  }
  if (affected.length > BULK_THRESHOLD && confirmedCount !== affected.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would remove ${String(affected.length)} entries from the queue. Confirm that count to go ahead.`,
    );
  }
  return ok({ ...q, items: q.items.filter((e) => !wanted.has(e.videoId)) });
}

export function reorder(q: QueueState, entryId: string, toIndex: number): ToolResult<QueueState> {
  const from = q.items.findIndex((e) => e.entryId === entryId);
  if (from === -1) return refuse(REFUSAL_REASON.noSuchVideo, 'That entry is no longer in the queue.');
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= q.items.length) {
    return refuse(
      REFUSAL_REASON.argumentsInvalid,
      `Position ${String(toIndex)} is outside the queue, which holds ${String(q.items.length)}.`,
    );
  }
  const items = [...q.items];
  const [moved] = items.splice(from, 1);
  items.splice(toIndex, 0, moved as QueueEntry);
  return ok({ ...q, items });
}

/** Clearing discards what the person built, so above the threshold it confirms. */
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
