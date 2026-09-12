import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { BULK_THRESHOLD } from '../vocab/tool-names.ts';
import { ok, refuse, type ToolResult } from '../mcp/result.ts';

/**
 * Collections of video references.
 *
 * Names are unique case-insensitively. Renaming a collection to a different
 * CASE of its own name is legitimate — it is that collection changing how it
 * displays itself — while colliding with a DIFFERENT collection's name is
 * refused rather than silently merging two collections into one.
 */
export interface Collection {
  readonly collectionId: string;
  readonly name: string;
  readonly videoIds: readonly string[];
  readonly createdAt: number;
}

export interface CollectionsState {
  readonly items: readonly Collection[];
}

export const EMPTY_COLLECTIONS: CollectionsState = { items: [] };

let seq = 0;
export function __resetCollectionIds(): void {
  seq = 0;
}

function normalise(name: string): string {
  return name.trim().toLowerCase();
}

function findByName(state: CollectionsState, name: string, exceptId?: string): Collection | undefined {
  return state.items.find((c) => normalise(c.name) === normalise(name) && c.collectionId !== exceptId);
}

export function createCollection(state: CollectionsState, name: string): ToolResult<{ state: CollectionsState; collection: Collection }> {
  if (name.trim() === '') {
    return refuse(REFUSAL_REASON.argumentsInvalid, 'A collection needs a name.');
  }
  const clash = findByName(state, name);
  if (clash !== undefined) {
    // Refused, never merged: two collections quietly becoming one is a loss the
    // person did not ask for and would not see.
    return refuse(REFUSAL_REASON.argumentsInvalid, `A collection called "${clash.name}" already exists.`);
  }
  seq += 1;
  const collection: Collection = { collectionId: `c${String(seq)}`, name: name.trim(), videoIds: [], createdAt: Date.now() };
  return ok({ state: { items: [...state.items, collection] }, collection });
}

export function renameCollection(state: CollectionsState, collectionId: string, name: string): ToolResult<{ state: CollectionsState; from: string; to: string }> {
  const target = state.items.find((c) => c.collectionId === collectionId);
  if (target === undefined) return refuse(REFUSAL_REASON.noSuchVideo, 'That collection no longer exists.');
  if (name.trim() === '') return refuse(REFUSAL_REASON.argumentsInvalid, 'A collection needs a name.');
  const clash = findByName(state, name, collectionId);
  if (clash !== undefined) {
    return refuse(REFUSAL_REASON.argumentsInvalid, `A different collection is already called "${clash.name}".`);
  }
  const to = name.trim();
  return ok({
    state: { items: state.items.map((c) => (c.collectionId === collectionId ? { ...c, name: to } : c)) },
    from: target.name,
    to,
  });
}

export function addToCollection(
  state: CollectionsState,
  collectionId: string,
  videoIds: readonly string[],
  confirmedCount?: number,
): ToolResult<{ state: CollectionsState; added: readonly string[]; alreadyPresent: readonly string[] }> {
  const target = state.items.find((c) => c.collectionId === collectionId);
  if (target === undefined) return refuse(REFUSAL_REASON.noSuchVideo, 'That collection no longer exists.');
  if (videoIds.length === 0) return refuse(REFUSAL_REASON.argumentsInvalid, 'No videos were given.');

  const alreadyPresent = videoIds.filter((id) => target.videoIds.includes(id));
  const added = videoIds.filter((id) => !target.videoIds.includes(id));
  if (added.length === 0) {
    // Reported, not silently treated as a success with no effect.
    return refuse(
      REFUSAL_REASON.argumentsInvalid,
      videoIds.length === 1
        ? `That video is already in "${target.name}".`
        : `All ${String(videoIds.length)} are already in "${target.name}".`,
    );
  }
  if (added.length > BULK_THRESHOLD && confirmedCount !== added.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would add ${String(added.length)} videos to "${target.name}". Confirm that count to go ahead.`,
    );
  }
  return ok({
    state: { items: state.items.map((c) => (c.collectionId === collectionId ? { ...c, videoIds: [...c.videoIds, ...added] } : c)) },
    added,
    alreadyPresent,
  });
}

/** Discards curation, so it names its target and confirms (FR-026). */
export function removeFromCollection(
  state: CollectionsState,
  collectionId: string,
  videoIds: readonly string[],
  confirmed: boolean,
  confirmedCount?: number,
): ToolResult<{ state: CollectionsState; removed: readonly string[] }> {
  const target = state.items.find((c) => c.collectionId === collectionId);
  if (target === undefined) return refuse(REFUSAL_REASON.noSuchVideo, 'That collection no longer exists.');
  const removed = videoIds.filter((id) => target.videoIds.includes(id));
  if (removed.length === 0) {
    return refuse(REFUSAL_REASON.noSuchVideo, `None of those are in "${target.name}".`);
  }
  if (removed.length > BULK_THRESHOLD && confirmedCount !== removed.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would remove ${String(removed.length)} videos from "${target.name}". Confirm that count to go ahead.`,
    );
  }
  if (!confirmed) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      removed.length === 1
        ? `Remove ${removed[0] ?? ''} from "${target.name}"? Confirm to go ahead.`
        : `Remove ${String(removed.length)} videos from "${target.name}"? Confirm to go ahead.`,
    );
  }
  const drop = new Set(removed);
  return ok({
    state: { items: state.items.map((c) => (c.collectionId === collectionId ? { ...c, videoIds: c.videoIds.filter((id) => !drop.has(id)) } : c)) },
    removed,
  });
}

export function deleteCollection(
  state: CollectionsState,
  collectionId: string,
  confirmedCount?: number,
): ToolResult<{ state: CollectionsState; deleted: Collection }> {
  const target = state.items.find((c) => c.collectionId === collectionId);
  if (target === undefined) return refuse(REFUSAL_REASON.noSuchVideo, 'That collection no longer exists.');
  // Always counted, whatever the size: deleting a whole collection discards
  // the container as well as its contents, which is categorically more than
  // removing the same videos one at a time.
  if (confirmedCount !== target.videoIds.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `Delete "${target.name}" and the ${String(target.videoIds.length)} video${target.videoIds.length === 1 ? '' : 's'} in it? Confirm that count to go ahead.`,
    );
  }
  return ok({ state: { items: state.items.filter((c) => c.collectionId !== collectionId) }, deleted: target });
}
