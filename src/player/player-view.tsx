import { useEffect, useRef, useState } from 'react';
import { loadIframeApi } from './iframe-api.ts';
import { createEmbeddedPlayer } from './youtube-adapter.ts';
import type { EmbeddedPlayer } from './player.ts';

/**
 * The embedded YouTube player (T116, research R10). Replaces the in-memory
 * stand-in that answered every call synchronously and never showed a video.
 *
 * It reports readiness and errors upward; it owns no playback state of its
 * own — the player does, and the tools read it back.
 */
export interface PlayerViewProps {
  readonly onReady: (player: EmbeddedPlayer) => void;
  readonly onChange: () => void;
  readonly onError: (code: number, videoId: string | null) => void;
  /** The current error, or null. */
  readonly status: string | null;
  /** The title (or id) of the video the player was last asked to play. */
  readonly nowPlaying: string | null;
}

export function PlayerView({ onReady, onChange, onError, status, nowPlaying }: PlayerViewProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  /** Observable readiness: before it, every playback tool truthfully answers "still loading". */
  const [ready, setReady] = useState(false);
  // Latest callbacks without re-creating the player when a parent re-renders.
  const callbacks = useRef({ onReady, onChange, onError });
  callbacks.current = { onReady, onChange, onError };

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let live = true;
    // The API replaces the element it is given, so it gets a child React does not own.
    const mount = document.createElement('div');
    element.appendChild(mount);
    loadIframeApi()
      .then((YT) =>
        createEmbeddedPlayer(YT, mount, {
          changed: () => { if (live) callbacks.current.onChange(); },
          error: (code, videoId) => { if (live) callbacks.current.onError(code, videoId); },
        }),
      )
      .then((player) => {
        if (!live) return;
        setReady(true);
        callbacks.current.onReady(player);
      })
      .catch((cause: unknown) => {
        if (live) setLoadFailure(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
      element.replaceChildren();
    };
  }, []);

  const shown = loadFailure ?? status;
  return (
    <section data-testid="player" data-ready={ready ? 'true' : 'false'} className="player">
      <div ref={host} className="player-screen" />
      {nowPlaying !== null && <p data-testid="now-playing" className="now-playing">Now playing: {nowPlaying}</p>}
      {shown !== null && (
        <p data-testid="player-status" role="status" className="player-status">
          {shown}
        </p>
      )}
    </section>
  );
}
