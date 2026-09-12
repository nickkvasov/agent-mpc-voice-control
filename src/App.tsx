import { useCallback, useRef, useState } from 'react';
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
      },
    );
  }, []);

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
      },
    );
  }, []);

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
          const r = await invokeRecorded(recorder, tool, args, label, () => run(queueRef.current));
          setOutcome(r.ok ? `${label}.` : `Refused: ${r.detail}`);
          if (r.ok) {
            queueRef.current = r.value;
            setQueue(r.value);
          }
        },
      );
    },
    [],
  );

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
        onQueue={(id) =>
          // FR-029: the entry must name what it acted on, not just "Queued".
          queueAction(`Queued ${id}`, TOOL.queueAdd, { videoIds: [id] }, (cur) => queueAdd(cur, [id]))
        }
      />
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
