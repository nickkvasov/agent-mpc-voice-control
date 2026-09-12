import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import type { YouTubePlayer } from '../player.ts';
import { nearestAvailableRate, setMutedWithReadback, setRateWithReadback, setVolumeWithReadback } from '../readback.ts';

export function setRate(p: YouTubePlayer, rate: number): ToolResult<{ rateApplied: number; rateRequested: number }> {
  if (!Number.isFinite(rate) || rate <= 0) {
    return refuse(REFUSAL_REASON.argumentsInvalid, `${String(rate)} is not a usable playback rate.`);
  }
  const target = nearestAvailableRate(p, rate);
  const back = setRateWithReadback(p, target);
  if (!back.honoured) {
    return refuse(
      REFUSAL_REASON.refusedByPlayer,
      `Asked for ${String(target)}x but the player is still at ${String(back.applied)}x.`,
    );
  }
  // FR-008: state the rate actually in effect, which may differ from the one asked for.
  return ok({ rateApplied: back.applied, rateRequested: rate });
}

export function setVolume(p: YouTubePlayer, volume: number): ToolResult<{ volumeApplied: number }> {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    return refuse(REFUSAL_REASON.argumentsInvalid, `${String(volume)} is not a volume between 0 and 100.`);
  }
  const back = setVolumeWithReadback(p, volume);
  if (!back.honoured) {
    // FR-009: platforms that ignore programmatic volume are reported, not
    // reported as success.
    return refuse(
      REFUSAL_REASON.refusedByPlayer,
      `This device would not let the volume be set to ${String(volume)}; it is still ${String(back.applied)}. Use the device's own volume control.`,
    );
  }
  return ok({ volumeApplied: back.applied });
}

export function setMuted(p: YouTubePlayer, muted: boolean): ToolResult<{ muted: boolean }> {
  const back = setMutedWithReadback(p, muted);
  if (!back.honoured) {
    return refuse(
      REFUSAL_REASON.refusedByPlayer,
      `This device would not ${muted ? 'mute' : 'unmute'} playback.`,
    );
  }
  return ok({ muted: back.applied });
}
