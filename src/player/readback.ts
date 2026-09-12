import type { YouTubePlayer } from './player.ts';

/**
 * Every setter is read back before its result is reported.
 *
 * FR-008 requires stating the rate actually in effect; FR-009 requires
 * reporting platform refusal rather than success. Without a readback a handler
 * reports its own intention, which is the bare success Constitution III forbids.
 *
 * **Readback is asynchronous.** The real IFrame API applies a rate or volume
 * change out of band, so reading it back in the same call stack can return the
 * PREVIOUS value and report a refusal for a change that then takes effect.
 * Gate C found this; the synchronous fake hid it. Each setter now settles with a
 * short deadline and reports `unsettled` when the value never arrives, which is
 * distinct from the player actively refusing.
 */
export interface Readback<T> {
  readonly requested: T;
  readonly applied: T;
  readonly honoured: boolean;
  /** True when the deadline passed without the value ever changing. */
  readonly unsettled: boolean;
}

export const SETTLE_TIMEOUT_MS = 400;
const POLL_MS = 25;

async function settle<T>(read: () => T, wanted: T, timeoutMs: number): Promise<{ applied: T; settled: boolean }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const applied = read();
    if (applied === wanted) return { applied, settled: true };
    if (Date.now() >= deadline) return { applied, settled: false };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function apply<T>(set: () => void, read: () => T, wanted: T, timeoutMs: number): Promise<Readback<T>> {
  set();
  const { applied, settled } = await settle(read, wanted, timeoutMs);
  return { requested: wanted, applied, honoured: settled, unsettled: !settled };
}

export function setRateWithReadback(p: YouTubePlayer, rate: number, timeoutMs = SETTLE_TIMEOUT_MS): Promise<Readback<number>> {
  return apply(() => p.setPlaybackRate(rate), () => p.getPlaybackRate(), rate, timeoutMs);
}

export function setVolumeWithReadback(p: YouTubePlayer, volume: number, timeoutMs = SETTLE_TIMEOUT_MS): Promise<Readback<number>> {
  return apply(() => p.setVolume(volume), () => p.getVolume(), volume, timeoutMs);
}

export function setMutedWithReadback(p: YouTubePlayer, muted: boolean, timeoutMs = SETTLE_TIMEOUT_MS): Promise<Readback<boolean>> {
  return apply(() => (muted ? p.mute() : p.unMute()), () => p.isMuted(), muted, timeoutMs);
}

/** The rate the player will actually accept nearest to the one asked for. */
export function nearestAvailableRate(p: YouTubePlayer, wanted: number): number {
  const rates = p.getAvailablePlaybackRates();
  if (rates.length === 0) return wanted;
  return rates.reduce((best, r) => (Math.abs(r - wanted) < Math.abs(best - wanted) ? r : best), rates[0] as number);
}

/** Waits for a predicate to hold, for effects with no single readable value. */
export async function settleUntil(check: () => boolean, timeoutMs = SETTLE_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
