import type { ActivityRecorder, ActivityEntry } from '../activity/record-writer.ts';
import type { Effect } from '../activity/effects.ts';
import { describeRecent, type DescribableEntry } from '../activity/describe.ts';
import { undoEntry } from '../activity/undo.ts';
import type { Command } from './commands.ts';
import type { DomainScheduler, FenceHandle } from './issue-fence.ts';
import { invokeRecorded } from './invoke.ts';
import { searchCatalog as defaultSearch, type QuotaView, type SearchResponse } from '../catalog/client.ts';
import { narrowLocally, type Criteria, type ResultSet } from '../catalog/results.ts';
import { resolveReference } from '../catalog/tools/resolve.ts';
import {
  addToCollection, createCollection, deleteCollection, removeFromCollection,
  type Collection, type CollectionsState,
} from '../curation/collections.ts';
import { planTags, setLabel } from '../curation/annotations.ts';
import { resolveConfirmation, resolveCountedConfirmation } from '../mcp/confirmation-resolver.ts';
import { ok, refuse, type ToolResult } from '../mcp/result.ts';
import { refuseUnsupportedCapability } from '../mcp/tool-availability.ts';
import { pause, play, stop, type PlaybackContext } from '../player/tools/transport.ts';
import { seek } from '../player/tools/seek.ts';
import { setMuted, setRate, setVolume } from '../player/tools/rate-volume.ts';
import { setCaptions } from '../player/tools/captions.ts';
import { seekToChapter } from '../player/tools/chapters.ts';
import { playerState, type YouTubePlayer } from '../player/player.ts';
import { add as queueAdd, clear as queueClear, removeEntries, removeVideo, reorder, sorted, type QueueState } from '../queue/queue.ts';
import { UNKNOWN, type VideoReference } from '../store/video-reference.ts';
import { domainsOf, TOOL_DOMAINS, PER_ENTRY, type CommandDomain } from '../vocab/command-domains.ts';
import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { BULK_THRESHOLD, isToolName, TOOL, type ToolName } from '../vocab/tool-names.ts';

/**
 * Every tool, as one function of (command, input) (Constitution II).
 *
 * Buttons, the local matcher and the assistant's MCP calls all arrive here, so
 * there is one path into state: recorded once (SC-006), attributed to its
 * command, ordered within its domains and refused when a newer command has
 * overtaken it (FR-038, research R7). Before Phase 9 this logic lived in
 * `App.tsx` callbacks that only buttons could reach, and no tool was
 * registered with MCP at all.
 *
 * Confirmation is asked HERE, inside the action, for every caller —
 * `agent-mcp-react`'s `confirmation: 'required'` gates only its own bridge, so a
 * page script would bypass it, and declaring both would ask the assistant path
 * twice. It is asked BEFORE the domain is taken, so a person reading a dialog
 * does not hold the domain (R7).
 */
export type ToolAction = (command: Command, input: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult<unknown>>;
export type ToolActions = Readonly<Record<ToolName, ToolAction>>;

type Annotations = ReadonlyMap<string, { label: string | null; tags: readonly string[] }>;

export interface ToolActionDeps {
  readonly recorder: ActivityRecorder;
  readonly scheduler: DomainScheduler;
  readonly player: () => YouTubePlayer;
  readonly playback: () => PlaybackContext;
  readonly results: { get(): ResultSet; set(next: ResultSet): void };
  /** Catalog facts with the person's annotations laid over them. */
  readonly videos: () => readonly VideoReference[];
  readonly annotations: {
    get(): Annotations;
    annotate(videoId: string, change: { label?: string | null; tags?: readonly string[] }): void;
    replace(next: Annotations): void;
  };
  readonly queue: { get(): QueueState; set(next: QueueState): void };
  readonly collections: {
    get(): CollectionsState;
    commit(next: CollectionsState): void;
    remember(deleted: Collection): void;
    deleted(collectionId: string): Collection | undefined;
  };
  readonly quota: { get(): QuotaView; set(next: QuotaView): void };
  readonly restore: {
    queue(queue: QueueState, effect: Effect): QueueState | null;
    annotations(current: Annotations, effect: Effect): Annotations | null;
    collections(current: CollectionsState, effect: Effect, deleted: Collection | undefined): CollectionsState | null;
  };
  /** Asks the person. Returns their answer, or null if they dismissed it. */
  readonly ask: (question: string) => string | null;
  readonly search?: (criteria: Criteria) => Promise<ToolResult<SearchResponse>>;
  /** Called after every action, so the interface re-reads state and the record. */
  readonly changed: () => void;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const optionalCriteria = (input: Record<string, unknown>, keys: readonly (keyof Criteria)[]): Criteria =>
  Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]])) as Criteria;

export function createToolActions(deps: ToolActionDeps): ToolActions {
  const search = deps.search ?? ((c: Criteria) => defaultSearch(c));

  /** The one path: record → order → act. */
  const run = async <T>(
    /** The call's signal; an action still waiting for its domain does not apply once it aborts. */
    signal: AbortSignal | undefined,
    tool: ToolName,
    command: Command,
    input: Record<string, unknown>,
    describe: string,
    body: (fence: FenceHandle) => Promise<ToolResult<T>> | ToolResult<T>,
    effectOf: ((value: T) => Effect | null) | null = null,
    domains: readonly CommandDomain[] = domainsOf(tool),
  ): Promise<ToolResult<unknown>> => {
    try {
      return await invokeRecorded(
        deps.recorder, tool, input, describe,
        () => deps.scheduler.run(command, domains, body, signal),
        effectOf, command.commandId,
      );
    } finally {
      deps.changed();
    }
  };

  const findVideos = (ids: readonly string[]): { found: VideoReference[]; missing: string[] } => {
    const all = deps.videos();
    const found = ids.map((id) => all.find((v) => v.videoId === id)).filter((v): v is VideoReference => v !== undefined);
    return { found, missing: ids.filter((id) => !found.some((v) => v.videoId === id)) };
  };

  /** A counted confirmation above the bulk threshold; the count must be said back (FR-027). */
  const countedAbove = (count: number, question: string): number | undefined =>
    count > BULK_THRESHOLD && resolveCountedConfirmation(deps.ask(question), count) === 'confirmed' ? count : undefined;

  const player = (): YouTubePlayer => deps.player();

  const actions: ToolActions = {
    // ── playback ──────────────────────────────────────────────────────────
    [TOOL.playbackPlay]: (c, i, sig) => run(sig, TOOL.playbackPlay, c, i, 'Play', () => play(player(), deps.playback())),
    [TOOL.playbackPause]: (c, i, sig) => run(sig, TOOL.playbackPause, c, i, 'Pause', () => pause(player(), deps.playback())),
    [TOOL.playbackStop]: (c, i, sig) => run(sig, TOOL.playbackStop, c, i, 'Stop', () => stop(player(), deps.playback())),
    [TOOL.playbackSeek]: (c, i, sig) => {
      const mode = i['mode'] === 'absolute' ? 'absolute' : 'relative';
      const seconds = num(i['seconds']) ?? 0;
      const label = mode === 'absolute' ? `Seek to ${String(seconds)}s` : `Seek ${seconds >= 0 ? 'forward' : 'back'} ${String(Math.abs(seconds))}s`;
      return run(sig, TOOL.playbackSeek, c, i, label, () => seek(player(), deps.playback(), mode, seconds));
    },
    [TOOL.playbackSeekToChapter]: (c, i, sig) =>
      // The current video's chapters are not known until the real player
      // reports which video is loaded (T116); until then this refuses with the
      // reason rather than guessing a position.
      run(sig, TOOL.playbackSeekToChapter, c, i, `Go to the chapter "${str(i['query'])}"`, () =>
        seekToChapter(player(), UNKNOWN, str(i['query']))),
    [TOOL.playbackSetRate]: (c, i, sig) =>
      run(sig, TOOL.playbackSetRate, c, i, `Set speed to ${String(num(i['rate']))}x`, () => setRate(player(), num(i['rate']) ?? 1)),
    [TOOL.playbackSetVolume]: (c, i, sig) =>
      run(sig, TOOL.playbackSetVolume, c, i, `Set volume to ${String(num(i['volume']))}`, () => setVolume(player(), num(i['volume']) ?? 0)),
    [TOOL.playbackSetMuted]: (c, i, sig) =>
      run(sig, TOOL.playbackSetMuted, c, i, i['muted'] === true ? 'Mute' : 'Unmute', () => setMuted(player(), i['muted'] === true)),
    [TOOL.playbackSetCaptions]: (c, i, sig) =>
      run(sig, TOOL.playbackSetCaptions, c, i, i['enabled'] === true ? 'Turn captions on' : 'Turn captions off', () =>
        setCaptions(player(), i['track'] === undefined ? { enabled: i['enabled'] === true } : { enabled: i['enabled'] === true, track: str(i['track']) })),
    [TOOL.playbackNext]: (c, i, sig) =>
      // The stand-in player cannot load a queued video; the real player does
      // (T116). Refused with that reason until then, never a pretend success.
      run(sig, TOOL.playbackNext, c, i, 'Next video', () => refuseUnsupportedCapability(TOOL.playbackNext)),
    [TOOL.playbackPrevious]: (c, i, sig) =>
      run(sig, TOOL.playbackPrevious, c, i, 'Previous video', () => refuseUnsupportedCapability(TOOL.playbackPrevious)),
    [TOOL.playbackGetState]: (c, i, sig) =>
      run(sig, TOOL.playbackGetState, c, i, 'Read the player state', () => {
        const p = player();
        return ok({
          state: playerState(p),
          positionSeconds: p.getCurrentTime(),
          durationSeconds: p.getDuration(),
          rate: p.getPlaybackRate(),
          volume: p.getVolume(),
          muted: p.isMuted(),
        });
      }),

    // ── catalog ───────────────────────────────────────────────────────────
    [TOOL.catalogSearch]: (c, i, sig) => {
      const criteria: Criteria = { query: str(i['query']), ...optionalCriteria(i, ['publishedAfter', 'publishedBefore']) };
      return run(sig, TOOL.catalogSearch, c, i, `Search for "${str(i['query'])}"`, async () => {
        const r = await search(criteria);
        if (!r.ok) return r;
        deps.quota.set(r.value.quota);
        deps.results.set({ items: r.value.items, criteria: r.value.criteriaApplied, operation: 'fresh_search', fromCache: r.value.fromCache, setAsideUnknown: 0 });
        return ok({ results: r.value.items, criteriaApplied: r.value.criteriaApplied, fromCache: r.value.fromCache, quota: r.value.quota });
      });
    },
    [TOOL.catalogNarrow]: (c, i, sig) => {
      const criteria = optionalCriteria(i, ['maxDurationSeconds', 'minDurationSeconds', 'publishedAfter', 'publishedBefore', 'titleContains']);
      return run(sig, TOOL.catalogNarrow, c, i, 'Narrow the current results', () => {
        const next = narrowLocally(deps.results.get(), criteria);
        deps.results.set(next);
        return ok({ results: next.items, criteriaApplied: next.criteria, narrowedFrom: 'current_results', setAsideUnknown: next.setAsideUnknown });
      });
    },
    [TOOL.catalogGetCurrentResults]: (c, i, sig) =>
      run(sig, TOOL.catalogGetCurrentResults, c, i, 'Read the current results', () =>
        ok({ results: deps.videos(), criteriaApplied: deps.results.get().criteria })),
    [TOOL.catalogResolveReference]: (c, i, sig) =>
      run(sig, TOOL.catalogResolveReference, c, i, `Work out which video "${str(i['reference'])}" means`, () =>
        resolveReference(deps.videos(), str(i['reference']))),
    [TOOL.catalogGetQuota]: (c, i, sig) => run(sig, TOOL.catalogGetQuota, c, i, 'Read the search allowance', () => ok(deps.quota.get())),

    // ── queue ─────────────────────────────────────────────────────────────
    [TOOL.queueAdd]: (c, i, sig) => {
      const ids = strs(i['videoIds']);
      const position = i['position'] === 'next' ? 'next' : 'end';
      const confirmed = countedAbove(ids.length, `Queue ${String(ids.length)} videos? Type the number to confirm.`);
      // Taken when the change applies, inside the held domain — not when issued (Gate C).
      let before = new Set<string>();
      return run(sig, TOOL.queueAdd, c, i, `Queue ${ids.join(', ')}`, () => {
        before = new Set(deps.queue.get().items.map((e) => e.entryId));
        const r = queueAdd(deps.queue.get(), ids, position, confirmed);
        if (r.ok) deps.queue.set(r.value);
        return r;
      }, (value) => {
        // Reversible as one occurrence; a multi-video add is recorded without an
        // inverse rather than with one that would undo only part of it.
        const appeared = value.items.filter((e) => !before.has(e.entryId));
        const one = appeared.length === 1 ? appeared[0] : undefined;
        return one === undefined ? null : { kind: 'queue_occurrence', entryId: one.entryId, added: true, videoId: one.videoId, order: one.order };
      });
    },
    [TOOL.queueRemove]: (c, i, sig) => {
      const ids = strs(i['videoIds']);
      const entryIds = strs(i['entryIds']);
      const issued = deps.queue.get().items;
      const matching = entryIds.length > 0
        ? issued.filter((e) => entryIds.includes(e.entryId)).length
        : issued.filter((e) => ids.includes(e.videoId)).length;
      // Replaced inside the held domain; the confirmation count above is what is revalidated.
      let snapshot = issued;
      const confirmed = countedAbove(matching, `Remove ${String(matching)} queued videos? Type the number to confirm.`);
      const named = entryIds.length > 0
        ? entryIds.map((id) => issued.find((e) => e.entryId === id)?.videoId ?? id).join(', ')
        : ids.join(', ');
      return run(sig, TOOL.queueRemove, c, i, `Removed ${named} from the queue`, () => {
        snapshot = deps.queue.get().items;
        const r = entryIds.length > 0 ? removeEntries(deps.queue.get(), entryIds, confirmed) : removeVideo(deps.queue.get(), ids, confirmed);
        if (r.ok) deps.queue.set(r.value);
        return r;
      }, (value) => {
        const gone = snapshot.filter((e) => !value.items.some((n) => n.entryId === e.entryId));
        const one = gone.length === 1 ? gone[0] : undefined;
        return one === undefined ? null : { kind: 'queue_occurrence', entryId: one.entryId, added: false, videoId: one.videoId, order: one.order };
      });
    },
    [TOOL.queueReorder]: (c, i, sig) =>
      run(sig, TOOL.queueReorder, c, i, `Move ${str(i['videoId'])} to position ${String(num(i['toIndex']))}`, () => {
        const entry = sorted(deps.queue.get().items).find((e) => e.videoId === str(i['videoId']));
        if (entry === undefined) return refuse(REFUSAL_REASON.noSuchVideo, `${str(i['videoId'])} is not in the queue.`);
        const r = reorder(deps.queue.get(), entry.entryId, num(i['toIndex']) ?? 0);
        if (r.ok) deps.queue.set(r.value);
        return r;
      }),
    [TOOL.queueClear]: (c, i, sig) => {
      const count = deps.queue.get().items.length;
      const confirmed = countedAbove(count, `Clear all ${String(count)} queued videos? Type the number to confirm.`);
      return run(sig, TOOL.queueClear, c, i, 'Clear the queue', () => {
        const r = queueClear(deps.queue.get(), confirmed);
        if (r.ok) deps.queue.set(r.value);
        return r;
      });
    },
    [TOOL.queueGet]: (c, i, sig) => run(sig, TOOL.queueGet, c, i, 'Read the queue', () => ok(deps.queue.get())),

    // ── curation ──────────────────────────────────────────────────────────
    [TOOL.curationCreateCollection]: (c, i, sig) =>
      run(sig, TOOL.curationCreateCollection, c, i, `Create collection "${str(i['name'])}"`, () => {
        const r = createCollection(deps.collections.get(), str(i['name']));
        if (r.ok) deps.collections.commit(r.value.state);
        return r.ok ? ok({ collectionId: r.value.collection.collectionId }) : r;
      }),
    [TOOL.curationAddToCollection]: (c, i, sig) => {
      const collectionId = str(i['collectionId']);
      const ids = strs(i['videoIds']);
      const target = deps.collections.get().items.find((x) => x.collectionId === collectionId);
      // The count that will actually change: videos already in it are not additions (Gate C).
      const additions = [...new Set(ids)].filter((id) => !(target?.videoIds.includes(id) ?? false)).length;
      const confirmed = countedAbove(additions, `Add ${String(additions)} videos to "${target?.name ?? collectionId}"? Type the number to confirm.`);
      return run(sig, TOOL.curationAddToCollection, c, i, `Add ${ids.join(', ')} to "${target?.name ?? collectionId}"`, () => {
        const r = addToCollection(deps.collections.get(), collectionId, ids, confirmed);
        if (r.ok) deps.collections.commit(r.value.state);
        return r;
      }, (v) => {
        const one = v.added.length === 1 ? v.added[0] : undefined;
        return one === undefined
          ? null
          : { kind: 'collection_member', collectionId, videoId: one, added: true, index: v.state.items.find((x) => x.collectionId === collectionId)?.videoIds.indexOf(one) ?? 0 };
      });
    },
    [TOOL.curationRemoveFromCollection]: (c, i, sig) => {
      const collectionId = str(i['collectionId']);
      const ids = strs(i['videoIds']);
      const target = deps.collections.get().items.find((x) => x.collectionId === collectionId);
      const name = target?.name ?? collectionId;
      // FR-026: names the specific target before discarding anything, for every caller.
      const confirmed = resolveConfirmation(deps.ask(`Remove ${ids.join(', ')} from "${name}"?`)) === 'confirmed';
      const removals = [...new Set(ids)].filter((id) => target?.videoIds.includes(id) ?? false).length;
      const counted = countedAbove(removals, `That removes ${String(removals)} videos from "${name}". Type the number to confirm.`);
      // Where the video was when it is actually removed, read inside the held
      // domain: an index taken at issue time restores to the wrong place when
      // another removal applied first (Gate C).
      let indexBefore = 0;
      return run(sig, TOOL.curationRemoveFromCollection, c, i, `Remove ${ids.join(', ')} from "${name}"`, () => {
        indexBefore = ids.length === 1
          ? (deps.collections.get().items.find((x) => x.collectionId === collectionId)?.videoIds.indexOf(ids[0] ?? '') ?? 0)
          : 0;
        const r = removeFromCollection(deps.collections.get(), collectionId, ids, confirmed, counted);
        if (r.ok) deps.collections.commit(r.value.state);
        return r;
      }, (v) => {
        const one = v.removed.length === 1 ? v.removed[0] : undefined;
        return one === undefined ? null : { kind: 'collection_member', collectionId, videoId: one, added: false, index: indexBefore };
      });
    },
    [TOOL.curationDeleteCollection]: (c, i, sig) => {
      const collectionId = str(i['collectionId']);
      const target = deps.collections.get().items.find((x) => x.collectionId === collectionId);
      const count = target?.videoIds.length ?? 0;
      // FR-027: the count is said back, not merely approved.
      const answer = deps.ask(`Delete "${target?.name ?? collectionId}" and the ${String(count)} video${count === 1 ? '' : 's'} in it? Type the number to confirm.`);
      const confirmed = resolveCountedConfirmation(answer, count) === 'confirmed';
      return run(sig, TOOL.curationDeleteCollection, c, i, `Delete collection "${target?.name ?? collectionId}"`, () => {
        const r = deleteCollection(deps.collections.get(), collectionId, confirmed ? count : undefined);
        if (r.ok) {
          deps.collections.remember(r.value.deleted);
          deps.collections.commit(r.value.state);
          return ok({ collectionId, deletedCount: count });
        }
        return r;
      }, () => ({ kind: 'collection_existence', collectionId, created: false }));
    },
    [TOOL.curationSetLabel]: (c, i, sig) => {
      const videoId = str(i['videoId']);
      const raw = i['label'];
      const label = typeof raw === 'string' && raw.trim() !== '' ? raw : null;
      return run(sig, TOOL.curationSetLabel, c, i, `Label ${videoId}`, () => {
        const video = findVideos([videoId]).found[0];
        if (video === undefined) return refuse(REFUSAL_REASON.noSuchVideo, `${videoId} is not among the loaded videos, so it cannot be labelled here.`);
        const r = setLabel(video, label);
        if (r.ok) deps.annotations.annotate(videoId, { label: r.value.label });
        return r;
      }, (v) => ({ kind: 'label', videoId, from: v.previousLabel, to: v.label }));
    },
    [TOOL.curationAddTags]: (c, i, sig) => tagAction(TOOL.curationAddTags, c, i, true, sig),
    [TOOL.curationRemoveTags]: (c, i, sig) => tagAction(TOOL.curationRemoveTags, c, i, false, sig),

    // ── activity ──────────────────────────────────────────────────────────
    [TOOL.activityList]: (c, i, sig) =>
      run(sig, TOOL.activityList, c, i, 'Read the activity record', () => {
        const limit = num(i['limit']) ?? 50;
        return ok({ entries: [...deps.recorder.entries()].sort((a, b) => b.sequence - a.sequence).slice(0, limit) });
      }),
    [TOOL.activityDescribeRecent]: (c, i, sig) =>
      run(sig, TOOL.activityDescribeRecent, c, i, 'Describe what was done recently', () =>
        // From the record itself, so the answer cannot disagree with it (FR-033).
        ok({ summary: describeRecent(deps.recorder.entries().map(toDescribable), num(i['count']) ?? 5) })),
    [TOOL.activityUndo]: (c, i, sig) => {
      const entryId = str(i['entryId']);
      const target = deps.recorder.entries().find((e) => e.entryId === entryId);
      const describe = target === undefined ? `Undo ${entryId}` : `Undo: ${target.description}`;
      // Fenced by the domains of the entry it reverses (R7).
      const declared = target !== undefined && isToolName(target.toolName) ? TOOL_DOMAINS[target.toolName] : [];
      const entryDomains = declared === PER_ENTRY ? [] : declared;
      return run(sig, TOOL.activityUndo, c, i, describe, () => {
        if (target === undefined) return refuse(REFUSAL_REASON.noSuchVideo, 'That entry is no longer in the record.');
        const r = undoEntry(target, deps.recorder.entries(), {
          apply: (effect) => {
            if (effect.kind === 'queue_occurrence') {
              const next = deps.restore.queue(deps.queue.get(), effect);
              if (next === null) return false;
              deps.queue.set(next);
              return true;
            }
            if (effect.kind === 'label' || effect.kind === 'tag') {
              const next = deps.restore.annotations(deps.annotations.get(), effect);
              if (next === null) return false;
              deps.annotations.replace(next);
              return true;
            }
            const collectionId = 'collectionId' in effect ? effect.collectionId : '';
            const restored = deps.restore.collections(deps.collections.get(), effect, deps.collections.deleted(collectionId));
            if (restored === null) return false;
            deps.collections.commit(restored);
            return true;
          },
        });
        if (r.ok) deps.recorder.markUndone(entryId);
        return r;
      }, null, domainsOf(TOOL.activityUndo, entryDomains));
    },
  };

  function tagAction(
    tool: typeof TOOL.curationAddTags | typeof TOOL.curationRemoveTags,
    c: Command,
    i: Record<string, unknown>,
    adding: boolean,
    sig: AbortSignal | undefined,
  ) {
    const ids = strs(i['videoIds']);
    const tags = strs(i['tags']);
    // The count that will actually change, planned against current tags (Gate C).
    const preview = planTags(findVideos(ids).found, tags, adding, Number.MAX_SAFE_INTEGER);
    const affected = preview.ok ? preview.value.changed.length : 0;
    const confirmed = countedAbove(affected, `${adding ? 'Tag' : 'Untag'} ${String(affected)} videos? Type the number to confirm.`);
    return run(sig, tool, c, i, `${adding ? 'Tag' : 'Untag'} ${ids.join(', ')} "${tags.join('", "')}"`, () => {
      const { found, missing } = findVideos(ids);
      if (missing.length > 0) return refuse(REFUSAL_REASON.noSuchVideo, `Not among the loaded videos: ${missing.join(', ')}. Nothing was changed.`);
      // Planned whole against the videos as they are now, then written once per
      // video with its final tags — never read back between tags (Gate C).
      const plan = planTags(found, tags, adding, confirmed);
      if (!plan.ok) return plan;
      for (const n of plan.value.next) deps.annotations.annotate(n.videoId, { tags: n.tags });
      return ok({ updated: plan.value.changed, unchanged: plan.value.unchanged, tags: plan.value.tags });
    }, () => (ids.length === 1 && tags.length === 1 ? { kind: 'tag', videoId: ids[0] ?? '', tag: tags[0]?.trim().toLowerCase() ?? '', added: adding } : null));
  }

  return actions;
}

function toDescribable(e: ActivityEntry): DescribableEntry {
  return {
    entryId: e.entryId,
    sequence: e.sequence,
    effect: e.effect,
    result: e.result,
    undone: e.undone,
    description: e.description,
    failureDetail: e.failureDetail,
    at: e.at,
  };
}
