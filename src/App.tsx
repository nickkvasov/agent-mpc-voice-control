import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls } from './player/controls.tsx';
import { CommandInput } from './app/command-input.tsx';
import { Interpretation } from './app/interpretation.tsx';
import { PushToTalk } from './voice/push-to-talk.tsx';
import { matchPlaybackCommand } from './matcher/playback-matcher.ts';
import { playerStateFromCode, PLAYER_STATE } from './vocab/player-states.ts';
import { recorder } from './activity/recorder.ts';
import { ResultsView } from './catalog/results-view.tsx';
import { RecordView } from './activity/record-view.tsx';
import { CurationView } from './curation/curation-view.tsx';
import { PrivacyDisclosure } from './app/privacy-disclosure.tsx';
import { ConnectionStatus, type ConnectionState } from './mcp/connection-status.tsx';
import { HistoryControls } from './app/history-controls.tsx';
import { EMPTY_COLLECTIONS, type Collection, type CollectionsState } from './curation/collections.ts';
import { applyCollectionUndo } from './curation/restore.ts';
import { applyAnnotationUndo } from './curation/annotation-restore.ts';
import { openStores } from './store/indexeddb.ts';
import { applyQueueUndo } from './queue/restore.ts';
import type { DescribableEntry } from './activity/describe.ts';
import { describeRecent } from './activity/describe.ts';
import { QueueView } from './queue/queue-view.tsx';
import { EMPTY, type ResultSet } from './catalog/results.ts';
import type { QuotaView } from './catalog/client.ts';
import { EMPTY_QUEUE, type QueueState } from './queue/queue.ts';
import { TOOL, type ToolName } from './vocab/tool-names.ts';
import type { EmbeddedPlayer } from './player/player.ts';
import { PlayerView } from './player/player-view.tsx';
import { describePlayerError } from './player/player-errors.ts';
import type { ToolResult } from './mcp/result.ts';
import { CommandRegistry, COMMAND_ROUTE, type CommandRoute } from './app/commands.ts';
import { issueText } from './app/command-intake.ts';
import { DomainScheduler } from './app/issue-fence.ts';
import { createToolActions, type ToolActions } from './app/tool-actions.ts';
import { ToolSurfaceProvider } from './mcp/declared-tools.tsx';


/** YouTube's code for "playing"; the vocabulary maps it, the tick only needs the raw value. */
const PLAYING_CODE = 1;
/** Well inside FR-013's one second. */
const POSITION_TICK_MS = 500;

export function App() {
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  /** The embedded player, once ready (T116). Null until then — never a stand-in. */
  const playerRef = useRef<EmbeddedPlayer | null>(null);
  const [playerStatus, setPlayerStatus] = useState<string | null>(null);
  const p = playerRef.current;

  /**
   * While a video plays the position changes with no player event at all, so
   * the controls re-read it on a short tick — only while playing. Found at
   * Gate B on the real embed: three seconds in, the controls still read 0s.
   */
  useEffect(() => {
    const tick = setInterval(() => {
      if (playerRef.current?.getPlayerState() === PLAYING_CODE) bump();
    }, POSITION_TICK_MS);
    return () => clearInterval(tick);
  }, [bump]);


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
    // The ref is the authority the actions read, so it is updated NOW. Setting
    // it inside a state updater — which React may run later — let a second
    // write in the same call read the first one's stale value (Phase 9 Gate C).
    const next = new Map(annotationsRef.current);
    const existing = next.get(videoId) ?? { label: null, tags: [] };
    next.set(videoId, { label: change.label !== undefined ? change.label : existing.label, tags: change.tags ?? existing.tags });
    annotationsRef.current = next;
    setAnnotations(next);
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

  /** Which collection "Add to collection" targets. Every click used to hit the first one. */
  const [destination, setDestination] = useState<string | null>(null);
  const destinationRef = useRef<string | null>(null);
  destinationRef.current = destination;

  /**
   * A destination that has been deleted is forgotten.
   *
   * Otherwise selecting B and then deleting B left every later Add capturing a
   * collection that no longer exists — and with one collection left the
   * selector is hidden, so there was no way to choose again and additions that
   * used to work simply refused (Gate C). Additions ALREADY enqueued keep the
   * destination they captured; this only affects what the next click captures.
   */
  useEffect(() => {
    if (destination !== null && !collections.items.some((c) => c.collectionId === destination)) {
      setDestination(null);
    }
  }, [collections, destination]);

  /**
   * The assistant's connection.
   *
   * `unavailable` is the honest default here: no gateway exists yet, so
   * claiming "connecting" forever would leave a person waiting for something
   * that is not coming (FR-037).
   */
  /**
   * Panels a person can close. Tools are declared by the view that shows them,
   * so a closed panel's tools do not exist — FR-035 as a consequence of the
   * structure. Before Phase 9 every view was permanently mounted, so "the view
   * is not open" could never happen and was never exercised.
   */
  const [showCollections, setShowCollections] = useState(true);
  const [showQueue, setShowQueue] = useState(true);

  const [connection] = useState<ConnectionState>('unavailable');
  const connectionReason = 'No agent gateway is configured for this deployment yet.';

  const [commandCount, setCommandCount] = useState(0);
  /** Whether voice is actually usable — the disclosure must not contradict it. */
  const [voiceAvailable, setVoiceAvailable] = useState(false);

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
      // FR-041: retained history must be VISIBLE and clearable. Starting at
      // zero told a person nothing was stored while their transcripts were
      // sitting in IndexedDB, and disabled the button that would clear them.
      const storedCommands = await outcome.stores.commands.all();
      setCommandCount(storedCommands.length);
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

  // The record view follows the record, whoever writes to it.
  useEffect(() => recorder.subscribe(refreshActivity), [refreshActivity]);

  /**
   * Latest-value refs the actions read, so an action issued earlier never acts
   * on a snapshot taken when it was created (the Phase 4 and Phase 6 lesson).
   */
  const resultsRef = useRef<ResultSet>(EMPTY);
  resultsRef.current = results;
  const quotaRef = useRef<QuotaView>(quota);
  quotaRef.current = quota;
  const changedRef = useRef<() => void>(() => {});
  changedRef.current = () => {
    refreshActivity();
    bump();
  };

  /** The one owner of commands and their order (FR-038, research R7). */
  const commands = useRef<CommandRegistry | null>(null);
  commands.current ??= new CommandRegistry();
  const scheduler = useRef<DomainScheduler | null>(null);
  scheduler.current ??= new DomainScheduler(commands.current);

  /** Every tool as one function of (command, input) — buttons, matcher and assistant alike. */
  const actionsRef = useRef<ToolActions | null>(null);
  actionsRef.current ??= createToolActions({
    recorder,
    scheduler: scheduler.current,
    player: () => playerRef.current,
    playback: () => ({ adPlaying: false, hasVideo: playerRef.current?.loadedVideoId() != null }),
    markUnavailable: (videoId, availability) => {
      const next = {
        ...resultsRef.current,
        items: resultsRef.current.items.map((v) => (v.videoId === videoId ? { ...v, availability } : v)),
      };
      resultsRef.current = next;
      setResults(next);
    },
    results: {
      get: () => resultsRef.current,
      set: (next) => {
        resultsRef.current = next;
        setResults(next);
      },
    },
    videos: () =>
      resultsRef.current.items.map((v) => {
        const mine = annotationsRef.current.get(v.videoId);
        return mine === undefined ? v : { ...v, label: mine.label, tags: mine.tags };
      }),
    annotations: {
      get: () => annotationsRef.current,
      annotate,
      replace: (next) => {
        annotationsRef.current = next;
        setAnnotations(next);
      },
    },
    queue: {
      get: () => queueRef.current,
      set: (next) => {
        queueRef.current = next;
        setQueue(next);
      },
    },
    collections: {
      get: () => collectionsRef.current,
      commit: commitCollections,
      remember: (c) => deletedCollections.current.set(c.collectionId, c),
      deleted: (id) => deletedCollections.current.get(id),
    },
    quota: {
      get: () => quotaRef.current,
      set: (next) => {
        quotaRef.current = next;
        setQuota(next);
      },
    },
    restore: { queue: applyQueueUndo, annotations: applyAnnotationUndo, collections: applyCollectionUndo },
    ask: (question) => globalThis.prompt?.(question) ?? null,
    changed: () => changedRef.current(),
  });
  const actions = actionsRef.current;
  const surface = useMemo(() => ({ actions, commands: commands.current as CommandRegistry }), [actions]);

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

  /**
   * A button press: the command is issued NOW, synchronously, so its place in
   * its domain is the moment it was pressed, not the moment it runs.
   */
  const perform = useCallback(
    async (
      tool: ToolName,
      input: Record<string, unknown>,
      describeOutcome: (value: unknown) => string,
      route: CommandRoute = COMMAND_ROUTE.manual,
    ): Promise<ToolResult<unknown>> => {
      const registry = commands.current as CommandRegistry;
      const command = registry.issue(route);
      try {
        const r = await actions[tool](command, input);
        setOutcome(r.ok ? describeOutcome(r.value) : `Refused: ${r.detail}`);
        return r;
      } catch (cause) {
        setOutcome(`That command failed: ${String(cause)}`);
        throw cause;
      } finally {
        registry.finish(command.commandId);
      }
    },
    [actions],
  );

  /**
   * A spoken or typed command, issued before its text exists (command-intake.ts).
   */
  const onText = useCallback(
    (resolveText: () => Promise<string>, modality: 'voice' | 'text', route: CommandRoute) => {
      issueText(commands.current as CommandRegistry, route, resolveText, {
        failed: (_command, cause) => setOutcome(`That command failed: ${String(cause)}`),
        run: async (command, text) => {
          setHeard(text);
          const m = matchPlaybackCommand(text);
          /**
           * Written AFTER the handler runs, with what actually happened.
           *
           * Appending on match recorded "applied" for commands the handler then
           * refused — `pause` with nothing playing, for instance — so the stored
           * history contradicted both the screen and the activity record (Gate C).
           */
          const persist = (outcome: 'applied' | 'refused', refusalReason: string | null): void => {
            void stores.current?.stores.commands
              .append({
                commandId: command.commandId,
                modality,
                rawText: text,
                interpretation: m.matched ? m.match.interpretation : 'not understood',
                route: m.matched ? 'local_matcher' : 'agent',
                receivedAt: command.issuedAt,
                outcome,
                refusalReason,
              })
              .then(async () => {
                const all = await stores.current?.stores.commands.all();
                setCommandCount(all?.length ?? 0);
              });
          };
          if (!m.matched) {
            // The matcher never guesses. With no agent connected there is nowhere
            // to fall through to, so this is refused with a reason (FR-034/FR-037).
            setInterpretation(null);
            setOutcome(
              'Not a playback command, and the assistant is not connected, so nothing was done. Everything here still works by hand.',
            );
            persist('refused', 'no_match');
            return;
          }
          setInterpretation(m.match.interpretation);
          let r: ToolResult<unknown>;
          try {
            r = await actions[m.match.tool](command, m.match.input);
          } catch (cause) {
            // The action recorded the failure and rethrew. Without this the
            // persist was skipped, so a command whose handler threw vanished
            // from retained history on the next reload (Gate C).
            persist('refused', 'handler_threw');
            throw cause;
          }
          setOutcome(r.ok ? 'Done.' : `Refused: ${r.detail}`);
          persist(r.ok ? 'applied' : 'refused', r.ok ? null : r.reason);
        },
      });
    },
    [actions],
  );

  /** Catalog facts with the person's annotations laid over them. */
  const annotated = results.items.map((v) => {
    const mine = annotations.get(v.videoId);
    return mine === undefined ? v : { ...v, label: mine.label, tags: mine.tags };
  });

  const captions = p?.getOption('captions', 'track');
  const track = typeof captions === 'object' && captions !== null
    ? String((captions as Record<string, unknown>)['languageCode'] ?? '')
    : '';

  return (
    <ToolSurfaceProvider surface={surface}>
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1rem' }}>
      <h1>Voice Video Control</h1>
      <ConnectionStatus state={connection} reason={connection === 'unavailable' ? connectionReason : null} />
      <PushToTalk
        onUtterance={(pending) => onText(() => pending, 'voice', COMMAND_ROUTE.voice)}
        onAvailabilityChange={setVoiceAvailable}
      />
      <CommandInput onCommand={(t) => onText(() => Promise.resolve(t), 'text', COMMAND_ROUTE.text)} />
      <Interpretation heard={heard} interpretation={interpretation} outcome={outcome} />
      <section data-testid="discovery" style={{ margin: '0.5rem 0' }}>
        <form
          data-testid="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get('q');
            if (typeof q === 'string' && q.trim() !== '') {
              void perform(TOOL.catalogSearch, { query: q }, (v) => `Found ${String((v as { results: unknown[] }).results.length)}.`);
            }
          }}
        >
          <label>
            Search the catalog <input name="q" data-testid="search-input" placeholder="state machines" />
          </label>{' '}
          <button type="submit" data-testid="search-submit">Search</button>{' '}
          <button
            type="button"
            data-testid="narrow-short"
            onClick={() => void perform(TOOL.catalogNarrow, { maxDurationSeconds: 600 }, () => 'Narrowed to under 10 minutes.')}
          >
            Only the short ones
          </button>
        </form>
      </section>
      <ResultsView
        results={results}
        quota={quota}
        onPlay={(id) => {
          const title = results.items.find((v) => v.videoId === id)?.title ?? id;
          setPlayerStatus(null);
          void perform(TOOL.playbackPlayVideo, { videoId: id }, () => `Playing "${title}".`);
        }}
        onAddToCollection={(id) => {
          // Captured at CLICK time. Reading it at execution time sent a video
          // to whichever collection happened to be selected when the queue
          // drained, not the one chosen when the button was pressed (Gate C).
          const wanted = destinationRef.current ?? collectionsRef.current.items[0]?.collectionId ?? null;
          if (wanted === null) {
            setOutcome('Create a collection first.');
            return;
          }
          const name = collectionsRef.current.items.find((c) => c.collectionId === wanted)?.name ?? wanted;
          void perform(TOOL.curationAddToCollection, { collectionId: wanted, videoIds: [id] }, () => `Added to "${name}".`);
        }}
        onQueue={(id) => void perform(TOOL.queueAdd, { videoIds: [id] }, () => `Queued ${id}.`)}
      />
      <p style={{ margin: '0.25rem 0' }}>
        <button type="button" data-testid="toggle-collections" onClick={() => setShowCollections((v) => !v)}>
          {showCollections ? 'Hide collections' : 'Show collections'}
        </button>{' '}
        <button type="button" data-testid="toggle-queue" onClick={() => setShowQueue((v) => !v)}>
          {showQueue ? 'Hide queue' : 'Show queue'}
        </button>
      </p>
      {showCollections && (
        <CurationView
          collections={collections.items}
          videos={annotated}
          storageDurable={storageDurable}
          destination={destination ?? collections.items[0]?.collectionId ?? null}
          onChooseDestination={setDestination}
          onRemoveVideo={(collectionId, videoId) =>
            void perform(TOOL.curationRemoveFromCollection, { collectionId, videoIds: [videoId] }, () => 'Removed.')
          }
          onLabel={(videoId) => {
            const video = annotated.find((v) => v.videoId === videoId);
            if (video === undefined) return;
            const answer = globalThis.prompt?.(`A label for "${video.title}"? Leave blank to clear it.`);
            if (answer === null || answer === undefined) return;
            void perform(
              TOOL.curationSetLabel,
              { videoId, label: answer.trim() === '' ? null : answer },
              (v) => `Labelled — the video is still "${(v as { sourceTitle: string }).sourceTitle}" on YouTube.`,
            );
          }}
          onTag={(videoId) => {
            const video = annotated.find((v) => v.videoId === videoId);
            if (video === undefined) return;
            const answer = globalThis.prompt?.(`A tag for "${video.title}"?`);
            if (answer === null || answer === undefined || answer.trim() === '') return;
            void perform(TOOL.curationAddTags, { videoIds: [videoId], tags: [answer] }, () => `Tagged "${answer.trim().toLowerCase()}".`);
          }}
          onCreate={(name) => void perform(TOOL.curationCreateCollection, { name }, () => `Created "${name}".`)}
          onDelete={(collectionId) => {
            const name = collectionsRef.current.items.find((c) => c.collectionId === collectionId)?.name ?? collectionId;
            void perform(TOOL.curationDeleteCollection, { collectionId }, () => `Deleted "${name}".`);
          }}
        />
      )}
      <HistoryControls
        commandCount={commandCount}
        onClear={() => {
          void stores.current?.stores.commands.clear();
          setCommandCount(0);
          // The transcript on screen IS retained text. Reporting it deleted
          // while it is still being displayed would be the disclosure
          // contradicting itself (Gate C, FR-041).
          setHeard(null);
          setInterpretation(null);
          setOutcome('Command history cleared from this device.');
        }}
      />
      <RecordView
        entries={activity}
        eligibilityContext={{
          blockedBy: (entry) => {
            // The same conflict the restoration path refuses on, asked BEFORE
            // the button is drawn — otherwise the person decides it will work
            // and is told afterwards that it will not (FR-044).
            const effect = entry.effect;
            if (effect === null || effect.kind !== 'collection_existence' || effect.created) return null;
            const gone = deletedCollections.current.get(effect.collectionId);
            if (gone === undefined) return null;
            const clash = collections.items.find(
              (c) => c.collectionId !== gone.collectionId && c.name.trim().toLowerCase() === gone.name.trim().toLowerCase(),
            );
            return clash === undefined
              ? null
              : `Cannot be restored: a collection called "${clash.name}" now uses that name.`;
          },
        }}
        onUndo={(entryId) =>
          void perform(TOOL.activityUndo, { entryId }, (v) => (v as { description: string }).description)
        }
      />
      <p data-testid="what-did-you-do" style={{ fontSize: '0.85rem', color: '#555', whiteSpace: 'pre-line' }}>
        {describeRecent(activity, 3)}
      </p>
      {showQueue && (
        <QueueView
          queue={queue}
          onRemoveEntry={(entryId) => {
            // Removes that ONE occurrence; the queue may hold a video twice.
            const videoId = queueRef.current.items.find((e) => e.entryId === entryId)?.videoId ?? 'unknown';
            void perform(TOOL.queueRemove, { entryIds: [entryId] }, () => `Removed ${videoId} from the queue.`);
          }}
        />
      )}
      <PlayerView
        status={playerStatus}
        onReady={(player) => {
          playerRef.current = player;
          bump();
        }}
        onChange={bump}
        onError={(code) => setPlayerStatus(describePlayerError(code).message)}
      />
      {/* Controls read state through the shared mapper, so they cannot disagree
          with what the tools reported. Before the player exists they show nothing
          playing, which is true. */}
      <Controls
        state={(p === null ? undefined : playerStateFromCode(p.getPlayerState())) ?? PLAYER_STATE.unstarted}
        positionSeconds={p?.getCurrentTime() ?? 0}
        durationSeconds={p?.getDuration() ?? 0}
        rate={p?.getPlaybackRate() ?? 1}
        volume={p?.getVolume() ?? 0}
        muted={p?.isMuted() ?? false}
        captionsTrack={track === '' ? null : track}
        onCommand={(t) => onText(() => Promise.resolve(t), 'text', COMMAND_ROUTE.manual)}
      />
      <PrivacyDisclosure voiceAvailable={voiceAvailable} assistantConnected={connection === 'connected'} />
    </main>
    </ToolSurfaceProvider>
  );
}
