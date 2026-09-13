import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { CommandRegistry } from '../../src/app/commands.ts';
import { DomainScheduler } from '../../src/app/issue-fence.ts';
import { createToolActions, type ToolActionDeps } from '../../src/app/tool-actions.ts';
import { EMPTY, type ResultSet } from '../../src/catalog/results.ts';
import { EMPTY_COLLECTIONS, type CollectionsState } from '../../src/curation/collections.ts';
import { applyCollectionUndo } from '../../src/curation/restore.ts';
import { makeVideoReference, type VideoReference } from '../../src/store/video-reference.ts';
import { ok } from '../../src/mcp/result.ts';
import { add as queueAdd, EMPTY_QUEUE, type QueueState } from '../../src/queue/queue.ts';
import type { YouTubePlayer } from '../../src/player/player.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';

/** A player whose seek readback the test releases by hand. */
function slowPlayer() {
  let time = 100, state = 1;
  const pendingSeeks: (() => void)[] = [];
  const p = {
    playVideo: () => { state = 1; }, pauseVideo: () => { state = 2; }, stopVideo: () => { state = 0; },
    seekTo: (s: number) => { pendingSeeks.push(() => { time = s; }); },
    getCurrentTime: () => time, getDuration: () => 600,
    setPlaybackRate: () => {}, getPlaybackRate: () => 1, getAvailablePlaybackRates: () => [1],
    setVolume: () => {}, getVolume: () => 50, mute: () => {}, unMute: () => {}, isMuted: () => false,
    getPlayerState: () => state, loadModule: () => {}, unloadModule: () => {},
    setOption: () => {}, getOption: () => undefined,
  } as unknown as YouTubePlayer;
  return { p, releaseSeek: () => pendingSeeks.splice(0).forEach((f) => { f(); }) };
}

interface SetupOptions {
  /** Annotations applied only when flushed, the way React applies a state updater later. */
  readonly deferredAnnotations?: boolean;
  readonly videos?: readonly VideoReference[];
  readonly search?: ToolActionDeps['search'];
  /** Answers by question, for prompts whose text the test cannot predict in order. */
  readonly answer?: (question: string) => string | null;
}

function setup(answers: (string | null)[] = [], opts: SetupOptions = {}) {
  const recorder = new ActivityRecorder(createInMemoryActivityStore());
  const commands = new CommandRegistry();
  const scheduler = new DomainScheduler(commands);
  let results: ResultSet = { ...EMPTY, items: opts.videos ?? [] };
  let annotations = new Map<string, { label: string | null; tags: readonly string[] }>();
  const pendingAnnotations: (() => void)[] = [];
  let queue: QueueState = EMPTY_QUEUE;
  let collections: CollectionsState = EMPTY_COLLECTIONS;
  const asked: string[] = [];
  const player = slowPlayer();
  const deps: ToolActionDeps = {
    recorder, scheduler,
    player: () => player.p,
    playback: () => ({ adPlaying: false, hasVideo: true }),
    results: { get: () => results, set: (n) => { results = n; } },
    videos: () => results.items.map((v) => {
      const mine = annotations.get(v.videoId);
      return mine === undefined ? v : { ...v, label: mine.label, tags: mine.tags };
    }),
    annotations: {
      get: () => annotations,
      annotate: (videoId, change) => {
        const apply = () => {
          const next = new Map(annotations);
          const cur = next.get(videoId) ?? { label: null, tags: [] };
          next.set(videoId, { label: change.label !== undefined ? change.label : cur.label, tags: change.tags ?? cur.tags });
          annotations = next;
        };
        if (opts.deferredAnnotations === true) pendingAnnotations.push(apply);
        else apply();
      },
      replace: (n) => { annotations = new Map(n); },
    },
    queue: { get: () => queue, set: (n) => { queue = n; } },
    collections: { get: () => collections, commit: (n) => { collections = n; }, remember: () => {}, deleted: () => undefined },
    quota: { get: () => ({ searchCallsRemaining: null, resetsAt: null }), set: () => {} },
    restore: { queue: () => null, annotations: () => null, collections: applyCollectionUndo },
    ask: (q) => { asked.push(q); return opts.answer?.(q) ?? answers.shift() ?? null; },
    ...(opts.search === undefined ? {} : { search: opts.search }),
    changed: () => {},
  };
  return {
    recorder, commands, actions: createToolActions(deps), asked, player,
    getQueue: () => queue, setQueue: (q: QueueState) => { queue = q; },
    getCollections: () => collections,
    tagsOf: (id: string) => annotations.get(id)?.tags ?? [],
    flushAnnotations: () => pendingAnnotations.splice(0).forEach((f) => { f(); }),
  };
}

describe('tool actions: one path, recorded once, ordered per domain', () => {
  it('an overtaken assistant seek is refused and recorded exactly once, attributed to its command', async () => {
    const { recorder, commands, actions } = setup();
    const older = commands.issue('agent');
    const newer = commands.issue('manual');
    expect((await actions[TOOL.playbackPause](newer, {})).ok).toBe(true);
    const r = await actions[TOOL.playbackSeek](older, { mode: 'relative', seconds: -10 });
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.overtakenByNewerCommand);
    const entries = recorder.entries();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ commandId: older.commandId, result: 'failed', refusalReason: REFUSAL_REASON.overtakenByNewerCommand });
    expect(entries[0]).toMatchObject({ commandId: newer.commandId, result: 'succeeded' });
  });

  it('a newer command in the same domain waits for an older one still in player readback', async () => {
    const { commands, actions, player } = setup();
    const seekCmd = commands.issue('manual');
    const pauseCmd = commands.issue('manual');
    const seeking = actions[TOOL.playbackSeek](seekCmd, { mode: 'absolute', seconds: 300 });
    const pausing = actions[TOOL.playbackPause](pauseCmd, {});
    const order: string[] = [];
    void seeking.then(() => order.push('seek'));
    void pausing.then(() => order.push('pause'));
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]); // pause holds its place behind the seek's readback
    player.releaseSeek();
    await Promise.all([seeking, pausing]);
    expect(order).toEqual(['seek', 'pause']);
  });

  it('queue.remove by entry removes exactly that occurrence of a video queued twice', async () => {
    const { commands, actions, getQueue, setQueue } = setup();
    const V = 'M7lc1UVf-VE';
    const once = queueAdd(EMPTY_QUEUE, [V]);
    if (!once.ok) throw new Error('setup');
    const twice = queueAdd(once.value, [V]);
    if (!twice.ok) throw new Error('setup');
    setQueue(twice.value);
    const first = twice.value.items[0]?.entryId ?? '';
    const r = await actions[TOOL.queueRemove](commands.issue('manual'), { entryIds: [first] });
    expect(r.ok).toBe(true);
    expect(getQueue().items.map((e) => e.videoId)).toEqual([V]);
    expect(getQueue().items[0]?.entryId).not.toBe(first);
  });

  it('removing from a collection asks first, naming it, and an unclear answer refuses', async () => {
    const V = 'M7lc1UVf-VE';
    const { commands, actions, asked, recorder } = setup(['maybe?']);
    const made = await actions[TOOL.curationCreateCollection](commands.issue('manual'), { name: 'Favourites' });
    if (!made.ok) throw new Error('setup');
    const collectionId = (made.value as { collectionId: string }).collectionId;
    expect((await actions[TOOL.curationAddToCollection](commands.issue('manual'), { collectionId, videoIds: [V] })).ok).toBe(true);

    const r = await actions[TOOL.curationRemoveFromCollection](commands.issue('agent'), { collectionId, videoIds: [V] });
    // Refused BECAUSE the answer was unclear — not because the collection is missing.
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.needsConfirmation);
    expect(asked.at(-1)).toContain(V);
    expect(asked.at(-1)).toContain('Favourites');
    expect(recorder.entries().at(-1)).toMatchObject({ result: 'failed', refusalReason: REFUSAL_REASON.needsConfirmation });
  });
});

const vid = (id: string, tags: readonly string[] = []) =>
  makeVideoReference({ videoId: id, title: `Video ${id}`, channelTitle: 'c', publishedAt: 0, tags });

/** A search the test releases by hand, so it holds the catalog lane for as long as needed. */
function heldSearch() {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const search: ToolActionDeps['search'] = async () => {
    await held;
    return ok({ items: [], criteriaApplied: {}, fromCache: false, quota: { searchCallsRemaining: null, resetsAt: null } });
  };
  return { search, release };
}

describe('Phase 9 Gate C findings, each reproduced before it was fixed', () => {
  const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB', C = 'CCCCCCCCCCC';

  it('[P1] a multi-tag call keeps every tag even when annotation updates apply later', async () => {
    const { commands, actions, tagsOf, flushAnnotations } = setup([], { deferredAnnotations: true, videos: [vid(A)] });
    const r = await actions[TOOL.curationAddTags](commands.issue('agent'), { videoIds: [A], tags: ['one', 'two', 'three'] });
    expect(r.ok).toBe(true);
    flushAnnotations();
    expect([...tagsOf(A)].sort()).toEqual(['one', 'three', 'two']);
  });

  it('[P1] a call cancelled while waiting for its domain is refused and changes nothing', async () => {
    const held = heldSearch();
    const { commands, actions, getCollections } = setup([], { search: held.search });
    void actions[TOOL.catalogSearch](commands.issue('manual'), { query: 'slow' });
    const controller = new AbortController();
    const creating = actions[TOOL.curationCreateCollection](commands.issue('agent'), { name: 'Favourites' }, controller.signal);
    controller.abort(); // its view closed while it waited behind the search
    held.release();
    const r = await creating;
    expect(r.ok ? '' : r.reason).toBe(REFUSAL_REASON.commandCancelled);
    expect(getCollections().items).toHaveLength(0);
  });

  it('[P2] undo snapshots are taken when the change applies, not when it was issued', async () => {
    const held = heldSearch();
    const { commands, actions, getCollections, recorder } = setup([], { search: held.search, answer: () => 'yes' });
    const made = await actions[TOOL.curationCreateCollection](commands.issue('manual'), { name: 'Favourites' });
    const collectionId = (made.ok ? made.value : { collectionId: '' }) as { collectionId: string };
    await actions[TOOL.curationAddToCollection](commands.issue('manual'), { collectionId: collectionId.collectionId, videoIds: [A, B, C] });
    expect(getCollections().items[0]?.videoIds).toEqual([A, B, C]);

    void actions[TOOL.catalogSearch](commands.issue('manual'), { query: 'slow' });
    const removeA = actions[TOOL.curationRemoveFromCollection](commands.issue('manual'), { collectionId: collectionId.collectionId, videoIds: [A] });
    const removeB = actions[TOOL.curationRemoveFromCollection](commands.issue('manual'), { collectionId: collectionId.collectionId, videoIds: [B] });
    held.release();
    await Promise.all([removeA, removeB]);
    expect(getCollections().items[0]?.videoIds).toEqual([C]);

    const removedB = recorder.entries().find((e) => e.description.startsWith(`Remove ${B}`));
    const undone = await actions[TOOL.activityUndo](commands.issue('manual'), { entryId: removedB?.entryId ?? '' });
    expect(undone.ok).toBe(true);
    // B was at index 0 when it was removed (A had already gone), so it returns to the front.
    expect(getCollections().items[0]?.videoIds).toEqual([B, C]);
  });

  it('[P2] a counted confirmation asks for the number that will actually change', async () => {
    const ids = ['V0000000001', 'V0000000002', 'V0000000003', 'V0000000004', 'V0000000005', 'V0000000006', 'V0000000007'];
    const { commands, actions, asked, getCollections } = setup([], {
      // Answers with whatever number the question states — so only a correct question succeeds.
      answer: (q) => /(\d+) videos/.exec(q)?.[1] ?? null,
    });
    const made = await actions[TOOL.curationCreateCollection](commands.issue('manual'), { name: 'Big' });
    const { collectionId } = (made.ok ? made.value : { collectionId: '' }) as { collectionId: string };
    await actions[TOOL.curationAddToCollection](commands.issue('manual'), { collectionId, videoIds: [ids[0] as string] });
    const r = await actions[TOOL.curationAddToCollection](commands.issue('agent'), { collectionId, videoIds: ids });
    expect(asked.at(-1)).toContain('6 videos');
    expect(r.ok).toBe(true);
    expect(getCollections().items[0]?.videoIds).toHaveLength(7);
  });

  it('[P2] a tag batch where one tag is already present is applied whole and recorded as applied', async () => {
    const { commands, actions, recorder, tagsOf } = setup([], { videos: [vid(A, ['existing'])] });
    const r = await actions[TOOL.curationAddTags](commands.issue('agent'), { videoIds: [A], tags: ['new', 'existing'] });
    expect(r.ok).toBe(true);
    expect([...tagsOf(A)].sort()).toEqual(['existing', 'new']);
    expect(recorder.entries().at(-1)).toMatchObject({ result: 'succeeded' });
  });

  it('[P2] a tag batch that cannot apply whole changes nothing and is recorded as refused', async () => {
    const { commands, actions, recorder, tagsOf } = setup([], { videos: [vid(A)] });
    const r = await actions[TOOL.curationAddTags](commands.issue('agent'), { videoIds: [A], tags: ['fine', '   '] });
    expect(r.ok).toBe(false);
    expect(tagsOf(A)).toEqual([]);
    expect(recorder.entries().at(-1)).toMatchObject({ result: 'failed' });
  });

  it('[round 2, P1] bulk tagging above the threshold asks for the count and applies when it is given', async () => {
    const six = ['T0000000001', 'T0000000002', 'T0000000003', 'T0000000004', 'T0000000005', 'T0000000006'];
    const { commands, actions, asked, tagsOf } = setup([], {
      videos: six.map((id) => vid(id)),
      answer: (q) => /(\d+) videos/.exec(q)?.[1] ?? null,
    });
    const r = await actions[TOOL.curationAddTags](commands.issue('agent'), { videoIds: six, tags: ['onboarding'] });
    expect(asked.at(-1)).toContain('6 videos');
    expect(r.ok).toBe(true);
    for (const id of six) expect(tagsOf(id)).toEqual(['onboarding']);
  });
});

