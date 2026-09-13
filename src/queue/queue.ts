import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolRefusal, type ToolResult } from '../mcp/result.ts';
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
  /**
   * The queue entry playing now, by entry — the queue may hold a video twice, so
   * a video id cannot say which occurrence is current (Phase 10 Gate C).
   */
  readonly currentEntryId: string | null;
}

export const EMPTY_QUEUE: QueueState = { items: [], currentEntryId: null };

let seq = 0;
/**
 * Keys are drawn from two monotonic counters that never reuse a value — one
 * climbing for appends, one falling for "play next".
 *
 * Computing a key from the LIVE entries instead let a removed-but-restorable
 * entry share a key with a new one: prepend B, remove B, prepend C, then undo
 * B, and both held the same key, so their order depended on which was inserted
 * into the array first (Gate C). A counter cannot collide with something it
 * has already issued.
 */
let ceiling = 0;
let floor = 0;

export function newEntry(videoId: string, order?: number): QueueEntry {
  seq += 1;
  if (order !== undefined) {
    // An explicit key above the append counter must move it, or a later append
    // lands before this entry (Phase 10 Gate C round 2).
    ceiling = Math.max(ceiling, Math.ceil(order));
    return { entryId: `q${String(seq)}`, videoId, order };
  }
  ceiling += 1;
  return { entryId: `q${String(seq)}`, videoId, order: ceiling };
}

export function nextKeyBefore(): number {
  floor -= 1;
  return floor;
}

export function __resetQueueIds(): void {
  seq = 0;
  ceiling = 0;
  floor = 0;
}

/**
 * Keeps the list in key order.
 *
 * The entry id breaks ties deterministically. Two keys should never be equal,
 * but if they ever were, falling back to array position would make the result
 * depend on the order things were restored in — the very property the key
 * exists to remove.
 */
export function sorted(items: readonly QueueEntry[]): readonly QueueEntry[] {
  return [...items].sort((a, b) => a.order - b.order || entrySeq(a) - entrySeq(b));
}

function entrySeq(e: QueueEntry): number {
  const n = Number(e.entryId.replace(/^q/, ''));
  return Number.isFinite(n) ? n : 0;
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
  const ordered = sorted(q.items);
  const at = q.currentEntryId === null ? -1 : ordered.findIndex((e) => e.entryId === q.currentEntryId);
  const entries =
    position !== 'next'
      ? videoIds.map((id) => newEntry(id))
      : at === -1
        // Nothing from the queue is playing: "next" is the front. Reversed so the
        // first named video ends up first once sorted.
        ? [...videoIds].reverse().map((id) => newEntry(id, nextKeyBefore())).reverse()
        // "Next" means after what is playing, not the front of the queue. Keys
        // are spread strictly between the current entry and the one after it.
        : spreadAfter(ordered, at, videoIds);
  if (!Array.isArray(entries)) return entries;
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
  // Moving something to where it already is must change nothing. Allocating a
  // fresh key anyway altered the outcome of a LATER undo, so a no-op quietly
  // had an effect (Gate C).
  if (from === toIndex) return ok(q);

  // The key must move with it. Splicing the array alone was silently undone by
  // the next sort, so an explicit reorder simply vanished (Gate C).
  const without = q.items.filter((e) => e.entryId !== entryId);
  const before = toIndex > 0 ? without[toIndex - 1] : undefined;
  const after = without[toIndex];
  // Two neighbours holding the same key leave no value between them, so a
  // midpoint would equal both and the tie-break would decide the order instead
  // of the request. Refused with a reason rather than applied wrongly
  // (Constitution III).
  if (before !== undefined && after !== undefined && before.order === after.order) {
    return refuse(
      REFUSAL_REASON.effectUnverifiable,
      'Two queue entries share a position, so there is no place to put this one between them. Remove or re-add one of them first.',
    );
  }
  const order =
    before === undefined && after === undefined
      ? (q.items[from] as QueueEntry).order
      : before === undefined
        ? nextKeyBefore()
        : after === undefined
          ? newEntry('', undefined).order
          : (before.order + after.order) / 2;
  if (before !== undefined && after !== undefined && (order === before.order || order === after.order)) {
    return refuse(
      REFUSAL_REASON.effectUnverifiable,
      'The queue positions are too close together to place this entry between them precisely.',
    );
  }
  const moved: QueueEntry = { ...(q.items[from] as QueueEntry), order };
  return ok({ ...q, items: sorted([...without, moved]) });
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

/** The smallest gap between keys this will allocate, to stay clear of float precision. */
const MIN_KEY_GAP = 1e-9;

function spreadAfter(ordered: readonly QueueEntry[], at: number, videoIds: readonly string[]): QueueEntry[] | ToolRefusal {
  const low = (ordered[at] as QueueEntry).order;
  const following = ordered[at + 1];
  const high = following === undefined ? low + 1 : following.order;
  const gap = (high - low) / (videoIds.length + 1);
  if (!(gap > MIN_KEY_GAP)) {
    // Tied neighbours — possible after an undo restores an entry at its old key.
    // A key between them does not exist; placing it anyway would silently put the
    // video in the wrong place. The same refusal `reorder` gives (Gate C round 2).
    return refuse(
      REFUSAL_REASON.effectUnverifiable,
      'Two queue entries share a position right after the current video, so there is no place to put this between them. Remove or re-add one of them first, or add it to the end.',
    );
  }
  return videoIds.map((id, i) => newEntry(id, low + gap * (i + 1)));
}

