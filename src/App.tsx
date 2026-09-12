import { useCallback, useEffect, useRef, useState } from 'react';
import { Controls } from './player/controls.tsx';
import { CommandInput } from './app/command-input.tsx';
import { Interpretation } from './app/interpretation.tsx';
import { PushToTalk } from './voice/push-to-talk.tsx';
import { matchPlaybackCommand } from './matcher/playback-matcher.ts';
import { playerStateFromCode, PLAYER_STATE } from './vocab/player-states.ts';
import { ActivityRecorder, createInMemoryActivityStore } from './activity/record-writer.ts';
import { invokeRecorded } from './app/invoke.ts';
import { CommandChain } from './app/command-chain.ts';
import { ResultsView } from './catalog/results-view.tsx';
import { RecordView } from './activity/record-view.tsx';
import { CurationView } from './curation/curation-view.tsx';
import {
  createCollection, deleteCollection, EMPTY_COLLECTIONS, type CollectionsState,
} from './curation/collections.ts';
import { resolveCountedConfirmation, resolveConfirmation } from './mcp/confirmation-resolver.ts';
import { addToCollection, removeFromCollection, type Collection } from './curation/collections.ts';
import { setLabel, addTag } from './curation/annotations.ts';
import { applyCollectionUndo } from './curation/restore.ts';
import { applyAnnotationUndo } from './curation/annotation-restore.ts';
import { openStores } from './store/indexeddb.ts';
import { undoEntry } from './activity/undo.ts';
import { applyQueueUndo } from './queue/restore.ts';
import type { DescribableEntry } from './activity/describe.ts';
import { describeRecent } from './activity/describe.ts';
import { QueueView } from './queue/queue-view.tsx';
import { EMPTY, narrowLocally, type ResultSet } from './catalog/results.ts';
import { searchCatalog, type QuotaView } from './catalog/client.ts';
import { add as queueAdd, removeEntries, EMPTY_QUEUE, type QueueState } from './queue/queue.ts';
import { TOOL } from './vocab/tool-names.ts';
import { pause, play, stop } from './player/tools/transport.ts';
import { seek } from './player/tools/seek.ts';
import { setMuted, setRate, setVolume } from './player/tools/rate-volume.ts';
import { setCaptions } from './player/tools/captions.ts';
import type { YouTubePlayer } from './player/player.ts';
import { isRefusal, type ToolResult } from './mcp/result.ts';

/** Local calls and agent calls write to the same record (SC-006). */
const recorder = new ActivityRecorder(createInMemoryActivityStore());

/**
 * US1: control playback by speaking or typing.
 *
 * The matcher and the (not yet connected) agent both reach the player through
 * the same tool functions, and the buttons call the same ones — which is what
 * makes conversational and manual control interchangeable (Principle I).
 *
 * The player here is a local stand-in so the slice is demonstrable before the
 * IFrame embed lands; every tool above it is the real one.
 */
function createLocalPlayer(onChange: () => void): YouTubePlayer {
  let state = 5, time = 0, rate = 1, volume = 50, muted = false;
  const options = new Map<string, unknown>();
  const touched = <T,>(v: T): T => {
    onChange();
    return v;
  };
  return {
    playVideo: () => touched((state = 1)),
    pauseVideo: () => touched((state = 2)),
    stopVideo: () => touched((state = 0)),
    seekTo: (s) => touched((time = s)),
    getCurrentTime: () => time,
    getDuration: () => 600,
    setPlaybackRate: (r) => touched((rate = r)),
    getPlaybackRate: () => rate,
    getAvailablePlaybackRates: () => [0.5, 1, 1.25, 1.5, 2],
    setVolume: (v) => touched((volume = v)),
    getVolume: () => volume,
    mute: () => touched((muted = true)),
    unMute: () => touched((muted = false)),
    isMuted: () => muted,
    getPlayerState: () => state,
    loadModule: () => {},
    unloadModule: () => {},
    setOption: (m, o, v) => touched(options.set(`${m}.${o}`, v)),
    getOption: (m, o) => options.get(`${m}.${o}`),
  } as YouTubePlayer;
}

export function App() {
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const player = useRef<YouTubePlayer | null>(null);
  player.current ??= createLocalPlayer(bump);
  const p = player.current;


  const [heard, setHeard] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const [results, setResults] = useState<ResultSet>(EMPTY);
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [quota, setQuota] = useState<QuotaView>({ searchCallsRemaining: null, resetsAt: null });

  /**
   * The person's own annotations, applied over the cached catalog facts.
   *
   * Held apart from the result set because they belong to different owners: a
   * label is theirs, a title is YouTube's. Recording a label without applying it
   * left the interface showing the source title while the record said it had
   * been labelled (Gate B).
   */
  const [annotations, setAnnotations] = useState<ReadonlyMap<string, { label: string | null; tags: readonly string[] }>>(new Map());
  const annotationsRef = useRef<ReadonlyMap<string, { label: string | null; tags: readonly string[] }>>(new Map());
  const annotate = useCallback((videoId: string, change: { label?: string | null; tags?: readonly string[] }) => {
    setAnnotations((cur) => {
      const next = new Map(cur);
      const existing = next.get(videoId) ?? { label: null, tags: [] };
      next.set(videoId, { label: change.label !== undefined ? change.label : existing.label, tags: change.tags ?? existing.tags });
      annotationsRef.current = next;
      return next;
    });
  }, []);

  const [collections, setCollections] = useState<CollectionsState>(EMPTY_COLLECTIONS);
  /**
   * Collections as they are NOW.
   *
   * The same lesson the queue taught in Phase 4 and I did not carry across:
   * serialising mutations does not make their inputs fresh. Two creations
   * enqueued while a search was pending both captured the same snapshot, so the
   * second replaced the first — and both were recorded as successes (Gate C).
   */
  const collectionsRef = useRef<CollectionsState>(EMPTY_COLLECTIONS);
  collectionsRef.current = collections;

  /** What a deleted collection held, so its undo can put it back whole. */
  const deletedCollections = useRef(new Map<string, Collection>());

  const [storageDurable, setStorageDurable] = useState<boolean | null>(null);
  const stores = useRef<Awaited<ReturnType<typeof openStores>> | null>(null);

  // FR-039: curation survives a reload. Hydrated once, and a non-durable store
  // is REPORTED rather than silently treated as session-only.
  useEffect(() => {
    let live = true;
    void openStores().then(async (outcome) => {
      if (!live) return;
      stores.current = outcome;
      setStorageDurable(outcome.durable);
      const saved = await outcome.stores.collections.all();
      if (saved.length > 0) setCollections({ items: [...saved] as Collection[] });
    });
    return () => {
      live = false;
    };
  }, []);

  const persistCollections = useCallback(async (next: CollectionsState) => {
    const s = stores.current;
    if (s === null) return;
    const existing = await s.stores.collections.all();
    for (const c of existing) {
      if (!next.items.some((n) => n.collectionId === c.collectionId)) await s.stores.collections.delete(c.collectionId);
    }
    for (const c of next.items) await s.stores.collections.put(c.collectionId, c);
  }, []);

  const commitCollections = useCallback(
    (next: CollectionsState) => {
      collectionsRef.current = next;
      setCollections(next);
      void persistCollections(next);
    },
    [persistCollections],
  );
  const [activity, setActivity] = useState<readonly DescribableEntry[]>([]);
  const refreshActivity = useCallback(() => {
    setActivity(
      recorder.entries().map((e) => ({
        entryId: e.entryId,
        sequence: e.sequence,
        effect: e.effect,
        result: e.result,
        undone: e.undone,
        description: e.description,
        failureDetail: e.failureDetail,
        at: e.at,
      })),
    );
  }, []);

  /** One order for voice, typing and buttons alike (FR-038). */
  const chain = useRef<CommandChain | null>(null);
  chain.current ??= new CommandChain({
    onError: (cause) => setOutcome(`That command failed: ${String(cause)}`),
  });

  const run = useCallback(
    async (text: string) => {
      setHeard(text);
      const m = matchPlaybackCommand(text);
      if (!m.matched) {
        // The matcher never guesses. With no agent connected there is nowhere
        // to fall through to, so this is refused with a reason (FR-034/FR-037).
        setInterpretation(null);
        setOutcome('Not a playback command, and the assistant is not connected, so nothing was done.');
        return;
      }
      setInterpretation(m.match.interpretation);
      const ctx = { adPlaying: false, hasVideo: true };
      const i = m.match.input;
      const call = (): Promise<ToolResult<unknown>> | ToolResult<unknown> => {
        switch (m.match.tool) {
          case TOOL.playbackPlay: return play(p, ctx);
          case TOOL.playbackPause: return pause(p, ctx);
          case TOOL.playbackStop: return stop(p, ctx);
          case TOOL.playbackSeek: return seek(p, ctx, i['mode'] as 'relative' | 'absolute', i['seconds'] as number);
          case TOOL.playbackSetRate: return setRate(p, i['rate'] as number);
          case TOOL.playbackSetVolume: return setVolume(p, i['volume'] as number);
          case TOOL.playbackSetMuted: return setMuted(p, i['muted'] as boolean);
          case TOOL.playbackSetCaptions: return setCaptions(p, { enabled: i['enabled'] as boolean });
          default: return { ok: false, reason: 'capability_unsupported', detail: `${m.match.tool} is not wired up in this slice.` } as ToolResult<unknown>;
        }
      };
      // Through the recorded boundary, so a local command leaves an entry just
      // as an agent call does.
      const r = await invokeRecorded(recorder, m.match.tool, i, m.match.interpretation, call);
      setOutcome(isRefusal(r) ? `Refused: ${r.detail}` : 'Done.');
      refreshActivity();
      bump();
    },
    [p, bump],
  );

  const enqueue = useCallback(
    (resolveText: () => Promise<string>) => {
      chain.current?.enqueue(resolveText, run);
    },
    [run],
  );

  /**
   * Discovery goes through the same ordering boundary as everything else
   * (FR-038) and the same recorded boundary (SC-006). Both were bypassed: a
   * slow search could overwrite a newer one, and no catalog or queue action
   * left an activity entry at all (Gate C).
   */
  const doSearch = useCallback((query: string) => {
    chain.current?.enqueue(
      () => Promise.resolve(query),
      async (q) => {
        const r = await invokeRecorded(recorder, TOOL.catalogSearch, { query: q }, `Search for "${q}"`, () =>
          searchCatalog({ query: q }),
        );
        if (!r.ok) {
          setOutcome(`Refused: ${r.detail}`);
          // The refusal IS evidence and was recorded; without this it stayed
          // invisible until some later action happened to refresh the panel.
          refreshActivity();
          return;
        }
        setQuota(r.value.quota);
        setResults({
          items: r.value.items,
          criteria: r.value.criteriaApplied,
          operation: 'fresh_search',
          fromCache: r.value.fromCache,
          setAsideUnknown: 0,
        });
        setOutcome(`Found ${String(r.value.items.length)}.`);
        refreshActivity();
      },
    );
  }, [refreshActivity]);

  const doNarrow = useCallback((maxMinutes: number) => {
    chain.current?.enqueue(
      () => Promise.resolve(String(maxMinutes)),
      async () => {
        // Local: spends no allowance (research.md R2).
        await invokeRecorded(
          recorder,
          TOOL.catalogNarrow,
          { maxDurationSeconds: maxMinutes * 60 },
          `Narrow to under ${String(maxMinutes)} minutes`,
          () => {
            setResults((cur) => narrowLocally(cur, { maxDurationSeconds: maxMinutes * 60 }));
            return { ok: true as const, value: null };
          },
        );
        setOutcome(`Narrowed to under ${String(maxMinutes)} minutes.`);
        refreshActivity();
      },
    );
  }, [refreshActivity]);

  /**
   * Holds the queue as it is NOW.
   *
   * Serialising mutations is not enough: two clicks made while a search was
   * pending both captured the queue as it was at click time, so the second
   * addition replaced the first instead of appending (Gate C). Ordering and
   * freshness are different problems.
   */
  const queueRef = useRef<QueueState>(EMPTY_QUEUE);
  queueRef.current = queue;

  const queueAction = useCallback(
    (
      label: string,
      tool: typeof TOOL.queueAdd | typeof TOOL.queueRemove,
      args: Record<string, unknown>,
      run: (current: QueueState) => ReturnType<typeof queueAdd>,
    ) => {
      chain.current?.enqueue(
        () => Promise.resolve(label),
        async () => {
          const before = new Set(queueRef.current.items.map((e) => e.entryId));
          const snapshot = queueRef.current.items;
          const r = await invokeRecorded(
            recorder, tool, args, label, () => run(queueRef.current),
            // Discovered from what actually changed, and attached by the writer
            // itself so it cannot land on a previous entry.
            (value) => {
              const appeared = value.items.find((e) => !before.has(e.entryId));
              if (appeared !== undefined) {
                return { kind: 'queue_occurrence', entryId: appeared.entryId, added: true, videoId: appeared.videoId, order: appeared.order };
              }
              const gone = snapshot.find((e) => !value.items.some((n) => n.entryId === e.entryId));
              return gone === undefined
                ? null
                : { kind: 'queue_occurrence', entryId: gone.entryId, added: false, videoId: gone.videoId, order: gone.order };
            },
          );
          setOutcome(r.ok ? `${label}.` : `Refused: ${r.detail}`);
          if (r.ok) {
            queueRef.current = r.value;
            setQueue(r.value);
          }
          refreshActivity();
        },
      );
    },
    [refreshActivity],
  );

  /**
   * Undo goes through the same ordering boundary as everything else (FR-038):
   * pressing it while a transcript is pending used to let it overtake the
   * earlier command. The target and the history are re-read when it RUNS, not
   * when the button was pressed.
   */
  const undoAction = useCallback(
    (entryId: string) => {
      chain.current?.enqueue(
        () => Promise.resolve(entryId),
        async () => {
          const entries = recorder.entries();
          const target = entries.find((e) => e.entryId === entryId);
          if (target === undefined) {
            setOutcome('That entry is no longer in the record.');
            refreshActivity();
            return;
          }
          // Through the recorded boundary, so a REFUSED undo leaves evidence
          // too — a refusal that vanishes is the gap this record exists to close.
          const r = await invokeRecorded(
            recorder,
            TOOL.activityUndo,
            { entryId },
            `Undo: ${target.description}`,
            () =>
              undoEntry({ ...target, entryId: target.entryId, description: target.description }, entries, {
                apply: (effect) => {
                  // Both restoration paths are module functions, not inline
                  // here, so tests can drive what the app runs.
                  if (effect.kind === 'queue_occurrence') {
                    const next = applyQueueUndo(queueRef.current, effect);
                    if (next === null) return false;
                    queueRef.current = next;
                    setQueue(next);
                    return true;
                  }
                  if (effect.kind === 'label' || effect.kind === 'tag') {
                    const next = applyAnnotationUndo(annotationsRef.current, effect);
                    if (next === null) return false;
                    annotationsRef.current = next;
                    setAnnotations(next);
                    return true;
                  }
                  const restored = applyCollectionUndo(
                    collectionsRef.current,
                    effect,
                    effect.kind === 'collection_existence' ? deletedCollections.current.get(effect.collectionId) : undefined,
                  );
                  if (restored === null) return false;
                  commitCollections(restored);
                  return true;
                },
              }),
          );
          if (r.ok) {
            recorder.markUndone(entryId);
            setOutcome(r.value.description);
          } else {
            setOutcome(`Refused: ${r.detail}`);
          }
          refreshActivity();
        },
      );
    },
    [refreshActivity],
  );

  /** Catalog facts with the person's annotations laid over them. */
  const annotated = results.items.map((v) => {
    const mine = annotations.get(v.videoId);
    return mine === undefined ? v : { ...v, label: mine.label, tags: mine.tags };
  });

  const captions = p.getOption('captions', 'track');
  const track = typeof captions === 'object' && captions !== null
    ? String((captions as Record<string, unknown>)['languageCode'] ?? '')
    : '';

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1rem' }}>
      <h1>Voice Video Control</h1>
      <PushToTalk onUtterance={(pending) => enqueue(() => pending)} />
      <CommandInput onCommand={(t) => enqueue(() => Promise.resolve(t))} />
      <Interpretation heard={heard} interpretation={interpretation} outcome={outcome} />
      <section data-testid="discovery" style={{ margin: '0.5rem 0' }}>
        <form
          data-testid="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get('q');
            if (typeof q === 'string' && q.trim() !== '') void doSearch(q);
          }}
        >
          <label>
            Search the catalog <input name="q" data-testid="search-input" placeholder="state machines" />
          </label>{' '}
          <button type="submit" data-testid="search-submit">Search</button>{' '}
          <button type="button" data-testid="narrow-short" onClick={() => doNarrow(10)}>
            Only the short ones
          </button>
        </form>
      </section>
      <ResultsView
        results={results}
        quota={quota}
        onPlay={(id) => setOutcome(`Would play ${id} once the player embed lands.`)}
        onAddToCollection={(id) =>
          chain.current?.enqueue(
            () => Promise.resolve(id),
            async () => {
              const first = collectionsRef.current.items[0];
              if (first === undefined) {
                setOutcome('Create a collection first.');
                return;
              }
              const r = await invokeRecorded(
                recorder, TOOL.curationAddToCollection, { collectionId: first.collectionId, videoIds: [id] },
                `Add ${id} to "${first.name}"`,
                () => {
                  const done = addToCollection(collectionsRef.current, first.collectionId, [id]);
                  if (done.ok) commitCollections(done.value.state);
                  return done;
                },
                () => ({ kind: 'collection_member', collectionId: first.collectionId, videoId: id, added: true }),
              );
              setOutcome(r.ok ? `Added to "${first.name}".` : `Refused: ${r.detail}`);
              refreshActivity();
            },
          )
        }
        onQueue={(id) =>
          // FR-029: the entry must name what it acted on, not just "Queued".
          queueAction(`Queued ${id}`, TOOL.queueAdd, { videoIds: [id] }, (cur) => queueAdd(cur, [id]))
        }
      />
      <CurationView
        collections={collections.items}
        videos={annotated}
        storageDurable={storageDurable}
        onRemoveVideo={(collectionId, videoId) =>
          chain.current?.enqueue(
            () => Promise.resolve(videoId),
            async () => {
              const target = collectionsRef.current.items.find((c) => c.collectionId === collectionId);
              // FR-026: names the specific target before it discards anything.
              const answer = globalThis.prompt?.(`Remove ${videoId} from "${target?.name ?? collectionId}"?`);
              const confirmed = resolveConfirmation(answer) === 'confirmed';
              const r = await invokeRecorded(
                recorder, TOOL.curationRemoveFromCollection, { collectionId, videoId },
                `Remove ${videoId} from "${target?.name ?? collectionId}"`,
                () => {
                  const done = removeFromCollection(collectionsRef.current, collectionId, [videoId], confirmed);
                  if (done.ok) commitCollections(done.value.state);
                  return done;
                },
                () => ({ kind: 'collection_member', collectionId, videoId, added: false }),
              );
              setOutcome(r.ok ? 'Removed.' : `Refused: ${r.detail}`);
              refreshActivity();
            },
          )
        }
        onLabel={(videoId) =>
          chain.current?.enqueue(
            () => Promise.resolve(videoId),
            async () => {
              const video = annotated.find((v) => v.videoId === videoId);
              if (video === undefined) return;
              const answer = globalThis.prompt?.(`A label for "${video.title}"? Leave blank to clear it.`);
              if (answer === null || answer === undefined) return;
              const r = await invokeRecorded(
                recorder, TOOL.curationSetLabel, { videoId, label: answer },
                `Label ${videoId}`,
                () => {
                  const done = setLabel(video, answer.trim() === '' ? null : answer);
                  if (done.ok) annotate(videoId, { label: done.value.label });
                  return done;
                },
                (v) => ({ kind: 'label', videoId, from: v.previousLabel, to: v.label }),
              );
              setOutcome(r.ok ? `Labelled — the video is still "${r.value.sourceTitle}" on YouTube.` : `Refused: ${r.detail}`);
              refreshActivity();
            },
          )
        }
        onTag={(videoId) =>
          chain.current?.enqueue(
            () => Promise.resolve(videoId),
            async () => {
              const video = annotated.find((v) => v.videoId === videoId);
              if (video === undefined) return;
              const answer = globalThis.prompt?.(`A tag for "${video.title}"?`);
              if (answer === null || answer === undefined || answer.trim() === '') return;
              const r = await invokeRecorded(
                recorder, TOOL.curationAddTags, { videoId, tag: answer },
                `Tag ${videoId} "${answer.trim()}"`,
                () => {
                  const done = addTag([video], answer);
                  if (done.ok) annotate(videoId, { tags: [...video.tags, done.value.tag] });
                  return done;
                },
                (v) => ({ kind: 'tag', videoId, tag: v.tag, added: true }),
              );
              setOutcome(r.ok ? `Tagged "${r.value.tag}".` : `Refused: ${r.detail}`);
              refreshActivity();
            },
          )
        }
        onCreate={(name) =>
          chain.current?.enqueue(
            () => Promise.resolve(name),
            async () => {
              const r = await invokeRecorded(
                recorder, TOOL.curationCreateCollection, { name }, `Created collection "${name}"`,
                () => {
                  const made = createCollection(collectionsRef.current, name);
                  if (made.ok) commitCollections(made.value.state);
                  return made;
                },
              );
              setOutcome(r.ok ? `Created "${name}".` : `Refused: ${r.detail}`);
              refreshActivity();
            },
          )
        }
        onDelete={(collectionId) =>
          chain.current?.enqueue(
            () => Promise.resolve(collectionId),
            async () => {
              const target = collectionsRef.current.items.find((c) => c.collectionId === collectionId);
              const count = target?.videoIds.length ?? 0;
              // FR-027: the COUNT must be said back, not merely approved. The
              // prompt names the collection and the number it holds.
              const answer = globalThis.prompt?.(
                `Delete "${target?.name ?? collectionId}" and the ${String(count)} video${count === 1 ? '' : 's'} in it? Type the number to confirm.`,
              );
              const confirmed = resolveCountedConfirmation(answer, count) === 'confirmed';
              const r = await invokeRecorded(
                recorder, TOOL.curationDeleteCollection, { collectionId, confirmed },
                `Delete collection "${target?.name ?? collectionId}"`,
                () => {
                  const done = deleteCollection(collectionsRef.current, collectionId, confirmed ? count : undefined);
                  if (done.ok) {
                    deletedCollections.current.set(collectionId, done.value.deleted);
                    commitCollections(done.value.state);
                  }
                  return done;
                },
                () => ({ kind: 'collection_existence', collectionId, created: false }),
              );
              setOutcome(r.ok ? `Deleted "${target?.name ?? collectionId}".` : `Refused: ${r.detail}`);
              refreshActivity();
            },
          )
        }
      />
      <RecordView
        entries={activity}
        onUndo={(entryId) => undoAction(entryId)}
      />
      <p data-testid="what-did-you-do" style={{ fontSize: '0.85rem', color: '#555', whiteSpace: 'pre-line' }}>
        {describeRecent(activity, 3)}
      </p>
      <QueueView
        queue={queue}
        onRemoveEntry={(entryId) => {
          // The label names the video as it was when clicked; the mutation
          // targets the entryId, which cannot drift if the queue changes first.
          const videoId = queueRef.current.items.find((e) => e.entryId === entryId)?.videoId ?? 'unknown';
          queueAction(
            `Removed ${videoId} from the queue`,
            TOOL.queueRemove,
            { entryId, videoId },
            (cur) => removeEntries(cur, [entryId]),
          );
        }}
      />
      {/* Controls read state through the shared mapper, so they cannot disagree
          with what the tools reported. */}
      <Controls
        state={playerStateFromCode(p.getPlayerState()) ?? PLAYER_STATE.unstarted}
        positionSeconds={p.getCurrentTime()}
        durationSeconds={p.getDuration()}
        rate={p.getPlaybackRate()}
        volume={p.getVolume()}
        muted={p.isMuted()}
        captionsTrack={track === '' ? null : track}
        onCommand={(t) => enqueue(() => Promise.resolve(t))}
      />
    </main>
  );
}
