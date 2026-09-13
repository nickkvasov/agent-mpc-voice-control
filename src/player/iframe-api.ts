/**
 * Loads the YouTube IFrame Player API exactly once (T113, research R10).
 *
 * Resolves when YouTube calls `onYouTubeIframeAPIReady`. A script that fails to
 * load, or never becomes ready, is a refusal with its reason — never a promise
 * that stays pending while the page shows an empty space where the player
 * should be.
 */
export interface YTPlayerOptions {
  readonly videoId?: string;
  readonly width?: string | number;
  readonly height?: string | number;
  readonly playerVars?: Readonly<Record<string, string | number>>;
  readonly events?: {
    readonly onReady?: (event: { target: YTPlayerInstance }) => void;
    readonly onStateChange?: (event: { target: YTPlayerInstance; data: number }) => void;
    readonly onError?: (event: { target: YTPlayerInstance; data: number }) => void;
    readonly onAutoplayBlocked?: (event: { target: YTPlayerInstance }) => void;
  };
}

/** The instance methods this application calls; see player.ts for what each means here. */
export interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(videoId: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
  loadModule(name: string): void;
  unloadModule(name: string): void;
  setOption(module: string, option: string, value: unknown): void;
  getOption(module: string, option: string): unknown;
  destroy(): void;
}

export interface YTNamespace {
  readonly Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayerInstance;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
export const API_READY_TIMEOUT_MS = 15_000;

let loading: Promise<YTNamespace> | null = null;

export function loadIframeApi(timeoutMs: number = API_READY_TIMEOUT_MS): Promise<YTNamespace> {
  if (loading !== null) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => {
      loading = null;
      reject(new Error(`The YouTube player did not become ready within ${String(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timer);
      if (window.YT === undefined) {
        loading = null;
        reject(new Error('The YouTube player script ran but provided no player.'));
        return;
      }
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      loading = null;
      reject(new Error('The YouTube player script could not be loaded.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
