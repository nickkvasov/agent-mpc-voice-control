import type { EmbeddedPlayer } from './player.ts';
import type { YTNamespace, YTPlayerInstance } from './iframe-api.ts';

/**
 * The real player behind the `EmbeddedPlayer` interface (T114, research R10).
 *
 * `playerVars.origin` is this page's own origin: without it YouTube cannot
 * verify the embedding page and answers with error 153 (R4). The adapter
 * records the two outcomes that end a request without playback — autoplay
 * blocked and a player error — and resets both on every new request, so a
 * tool reads the outcome of ITS request, not a stale one.
 */
export interface AdapterEvents {
  /** Any state, error or blocked-autoplay event: the interface should re-read. */
  readonly changed: () => void;
  readonly error: (code: number, videoId: string | null) => void;
}

export function createEmbeddedPlayer(
  YT: YTNamespace,
  host: HTMLElement,
  events: AdapterEvents,
): Promise<EmbeddedPlayer> {
  let loaded: string | null = null;
  let blocked = false;
  let error: { code: number; videoId: string | null } | null = null;

  return new Promise((resolve) => {
    const player: YTPlayerInstance = new YT.Player(host, {
      width: '100%',
      height: '100%',
      playerVars: { origin: window.location.origin, playsinline: 1, rel: 0 },
      events: {
        onReady: () => resolve(adapter),
        onStateChange: () => events.changed(),
        onAutoplayBlocked: () => {
          blocked = true;
          events.changed();
        },
        onError: (e) => {
          error = { code: e.data, videoId: loaded };
          events.error(e.data, loaded);
          events.changed();
        },
      },
    });

    const reset = (): void => {
      blocked = false;
      error = null;
    };

    const adapter: EmbeddedPlayer = {
      loadVideoById: (videoId) => {
        reset();
        loaded = videoId;
        player.loadVideoById(videoId);
      },
      loadedVideoId: () => loaded,
      autoplayBlocked: () => blocked,
      lastError: () => error,
      playVideo: () => {
        reset();
        player.playVideo();
      },
      pauseVideo: () => player.pauseVideo(),
      stopVideo: () => player.stopVideo(),
      seekTo: (seconds, allowSeekAhead) => player.seekTo(seconds, allowSeekAhead),
      getCurrentTime: () => player.getCurrentTime(),
      getDuration: () => player.getDuration(),
      setPlaybackRate: (rate) => player.setPlaybackRate(rate),
      getPlaybackRate: () => player.getPlaybackRate(),
      getAvailablePlaybackRates: () => player.getAvailablePlaybackRates(),
      setVolume: (volume) => player.setVolume(volume),
      getVolume: () => player.getVolume(),
      mute: () => player.mute(),
      unMute: () => player.unMute(),
      isMuted: () => player.isMuted(),
      getPlayerState: () => player.getPlayerState(),
      loadModule: (name) => player.loadModule(name),
      unloadModule: (name) => player.unloadModule(name),
      setOption: (module, option, value) => player.setOption(module, option, value),
      getOption: (module, option) => player.getOption(module, option),
    };
  });
}
