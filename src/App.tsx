import { useCallback, useRef, useState } from 'react';
import { Controls } from './player/controls.tsx';
import { CommandInput } from './app/command-input.tsx';
import { Interpretation } from './app/interpretation.tsx';
import { PushToTalk } from './voice/push-to-talk.tsx';
import { matchPlaybackCommand } from './matcher/playback-matcher.ts';
import { playerStateFromCode, PLAYER_STATE } from './vocab/player-states.ts';
import { ActivityRecorder, createInMemoryActivityStore } from './activity/record-writer.ts';
import { invokeRecorded } from './app/invoke.ts';
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

  /**
   * Commands are applied strictly in the order they were ISSUED (FR-038).
   *
   * A spoken command's transcript resolves after the person has let go, so
   * without this chain a click made during that gap would be applied first and
   * then overridden by the older utterance. The chain reserves each command's
   * place at the moment it was issued.
   */
  const chain = useRef<Promise<void>>(Promise.resolve());

  const [heard, setHeard] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

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
      chain.current = chain.current.then(async () => {
        const text = await resolveText();
        if (text.trim() === '') return;
        await run(text);
      });
    },
    [run],
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
