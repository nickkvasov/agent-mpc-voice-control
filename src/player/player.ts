import { PLAYER_STATE, playerStateFromCode, type PlayerState } from '../vocab/player-states.ts';
import { AVAILABILITY, PLAYER_ERROR_TO_AVAILABILITY, type Availability } from '../vocab/availability.ts';

/**
 * The IFrame Player API surface this application uses.
 *
 * Declared as an interface rather than reaching for the global so the layers
 * above it can be driven in tests without a real player or a network.
 */
export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): readonly number[];
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
}

/**
 * What the embedded player knows beyond the IFrame method surface: which video
 * it was asked to load, and the two ways a request ends without playback —
 * the browser blocking autoplay, and a player error (research R10).
 *
 * Both reset on every new load or play request, so they describe THIS request.
 */
export interface EmbeddedPlayer extends YouTubePlayer {
  loadVideoById(videoId: string): void;
  loadedVideoId(): string | null;
  autoplayBlocked(): boolean;
  lastError(): { readonly code: number; readonly videoId: string | null } | null;
}

export function isEmbeddedPlayer(p: YouTubePlayer): p is EmbeddedPlayer {
  return typeof (p as Partial<EmbeddedPlayer>).autoplayBlocked === 'function';
}

export interface CaptionTrack {
  readonly languageCode: string;
  readonly displayName: string;
}

export function playerState(p: YouTubePlayer): PlayerState {
  return playerStateFromCode(p.getPlayerState()) ?? PLAYER_STATE.unstarted;
}

/**
 * Maps a player error code to the specific reason FR-036 requires.
 *
 * 153 is deliberately absent: it means a missing HTTP Referer, which is an
 * origin problem and NOT a property of the video. Reporting it as an
 * availability reason would send someone debugging their page into the
 * catalogue instead (see NOTES.md, 2026-09-12).
 */
export function availabilityFromError(code: number): Availability {
  return PLAYER_ERROR_TO_AVAILABILITY[code] ?? AVAILABILITY.unknown;
}

export const ORIGIN_ERROR_CODE = 153;

export function isOriginError(code: number): boolean {
  return code === ORIGIN_ERROR_CODE;
}
