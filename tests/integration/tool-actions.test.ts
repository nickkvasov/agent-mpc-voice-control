import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { CommandRegistry } from '../../src/app/commands.ts';
import { DomainScheduler } from '../../src/app/issue-fence.ts';
import { createToolActions, type ToolActionDeps } from '../../src/app/tool-actions.ts';
import { EMPTY, type ResultSet } from '../../src/catalog/results.ts';
import { EMPTY_COLLECTIONS, type CollectionsState } from '../../src/curation/collections.ts';
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

function setup(answers: (string | null)[] = []) {
  const recorder = new ActivityRecorder(createInMemoryActivityStore());
  const commands = new CommandRegistry();
  const scheduler = new DomainScheduler(commands);
  let results: ResultSet = EMPTY;
  let queue: QueueState = EMPTY_QUEUE;
  let collections: CollectionsState = EMPTY_COLLECTIONS;
  const asked: string[] = [];
  const player = slowPlayer();
  const deps: ToolActionDeps = {
    recorder, scheduler,
    player: () => player.p,
    playback: () => ({ adPlaying: false, hasVideo: true }),
    results: { get: () => results, set: (n) => { results = n; } },
    videos: () => results.items,
    annotations: { get: () => new Map(), annotate: () => {}, replace: () => {} },
    queue: { get: () => queue, set: (n) => { queue = n; } },
    collections: { get: () => collections, commit: (n) => { collections = n; }, remember: () => {}, deleted: () => undefined },
    quota: { get: () => ({ searchCallsRemaining: null, resetsAt: null }), set: () => {} },
    restore: { queue: () => null, annotations: () => null, collections: () => null },
    ask: (q) => { asked.push(q); return answers.shift() ?? null; },
    changed: () => {},
  };
  return { recorder, commands, actions: createToolActions(deps), asked, player, getQueue: () => queue, setQueue: (q: QueueState) => { queue = q; } };
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
