import { useCallback, useRef, useState } from 'react';
import { Controls } from './player/controls.tsx';
import { CommandInput } from './app/command-input.tsx';
import { Interpretation } from './app/interpretation.tsx';
import { PushToTalk } from './voice/push-to-talk.tsx';
import { matchPlaybackCommand } from './matcher/playback-matcher.ts';
import { PLAYER_STATE, type PlayerState } from './vocab/player-states.ts';
import { TOOL } from './vocab/tool-names.ts';
import { pause, play, stop } from './player/tools/transport.ts';
import { seek } from './player/tools/seek.ts';
import { setMuted, setRate, setVolume } from './player/tools/rate-volume.ts';
import { setCaptions } from './player/tools/captions.ts';
import type { YouTubePlayer } from './player/player.ts';
import { isRefusal, type ToolResult } from './mcp/result.ts';

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

  const run = useCallback(
    (text: string) => {
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
      const ad = { adPlaying: false };
      const i = m.match.input;
      let r: ToolResult<unknown>;
      switch (m.match.tool) {
        case TOOL.playbackPlay: r = play(p, ad); break;
        case TOOL.playbackPause: r = pause(p, ad); break;
        case TOOL.playbackStop: r = stop(p, ad); break;
        case TOOL.playbackSeek: r = seek(p, ad, i['mode'] as 'relative' | 'absolute', i['seconds'] as number); break;
        case TOOL.playbackSetRate: r = setRate(p, i['rate'] as number); break;
        case TOOL.playbackSetVolume: r = setVolume(p, i['volume'] as number); break;
        case TOOL.playbackSetMuted: r = setMuted(p, i['muted'] as boolean); break;
        case TOOL.playbackSetCaptions: r = setCaptions(p, { enabled: i['enabled'] as boolean }); break;
        default:
          setOutcome(`${m.match.tool} is not wired up in this slice.`);
          return;
      }
      setOutcome(isRefusal(r) ? `Refused: ${r.detail}` : 'Done.');
      bump();
    },
    [p, bump],
  );

  const captions = p.getOption('captions', 'track');
  const track = typeof captions === 'object' && captions !== null
    ? String((captions as Record<string, unknown>)['languageCode'] ?? '')
    : '';

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1rem' }}>
      <h1>Voice Video Control</h1>
      <PushToTalk onUtterance={run} />
      <CommandInput onCommand={run} />
      <Interpretation heard={heard} interpretation={interpretation} outcome={outcome} />
      <Controls
        state={(p.getPlayerState() === 1 ? PLAYER_STATE.playing : p.getPlayerState() === 2 ? PLAYER_STATE.paused : PLAYER_STATE.cued) as PlayerState}
        positionSeconds={p.getCurrentTime()}
        durationSeconds={p.getDuration()}
        rate={p.getPlaybackRate()}
        volume={p.getVolume()}
        muted={p.isMuted()}
        captionsTrack={track === '' ? null : track}
        onCommand={run}
      />
    </main>
  );
}
