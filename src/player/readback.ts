import type { YouTubePlayer } from './player.ts';

/**
 * Every setter is read back before its result is reported.
 *
 * FR-008 requires the system to state the rate it actually got, and FR-009
 * requires reporting platform refusal rather than success — mobile browsers
 * commonly ignore programmatic volume. Without a readback the handler would be
 * reporting its own intention, which is the bare success Constitution III
 * forbids.
 */
export interface Readback<T> {
  readonly requested: T;
  readonly applied: T;
  readonly honoured: boolean;
}

export function setRateWithReadback(p: YouTubePlayer, rate: number): Readback<number> {
  p.setPlaybackRate(rate);
  const applied = p.getPlaybackRate();
  return { requested: rate, applied, honoured: applied === rate };
}

export function setVolumeWithReadback(p: YouTubePlayer, volume: number): Readback<number> {
  p.setVolume(volume);
  const applied = p.getVolume();
  return { requested: volume, applied, honoured: applied === volume };
}

export function setMutedWithReadback(p: YouTubePlayer, muted: boolean): Readback<boolean> {
  if (muted) p.mute();
  else p.unMute();
  const applied = p.isMuted();
  return { requested: muted, applied, honoured: applied === muted };
}

/** The rate the player will actually accept nearest to the one asked for. */
export function nearestAvailableRate(p: YouTubePlayer, wanted: number): number {
  const rates = p.getAvailablePlaybackRates();
  if (rates.length === 0) return wanted;
  return rates.reduce((best, r) => (Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best), rates[0] as number);
}
