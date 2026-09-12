import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import type { YouTubePlayer } from '../player.ts';
import { nearestAvailableRate, setMutedWithReadback, setRateWithReadback, setVolumeWithReadback } from '../readback.ts';

export async function setRate(p: YouTubePlayer, rate: number, timeoutMs?: number): Promise<ToolResult<{ rateApplied: number; rateRequested: number }>> {
  if (!Number.isFinite(rate) || rate <= 0) {
    return refuse(REFUSAL_REASON.argumentsInvalid, `${String(rate)} is not a usable playback rate.`);
  }
  const target = nearestAvailableRate(p, rate);
  const back = await setRateWithReadback(p, target, timeoutMs);
  if (!back.honoured) {
    return refuse(
      REFUSAL_REASON.refusedByPlayer,
      back.unsettled
        ? `Asked for ${String(target)}x; the player was still at ${String(back.applied)}x after waiting, so the change was not established.`
        : `Asked for ${String(target)}x but the player is at ${String(back.applied)}x.`,
    );
  }
  // FR-008: state the rate actually in effect, which may differ from the one asked for.
  return ok({ rateApplied: back.applied, rateRequested: rate });
}

export async function setVolume(p: YouTubePlayer, volume: number, timeoutMs?: number): Promise<ToolResult<{ volumeApplied: number }>> {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    return refuse(REFUSAL_REASON.argumentsInvalid, `${String(volume)} is not a volume between 0 and 100.`);
  }
  const back = await setVolumeWithReadback(p, volume, timeoutMs);
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

export async function setMuted(p: YouTubePlayer, muted: boolean): Promise<ToolResult<{ muted: boolean }>> {
  const back = await setMutedWithReadback(p, muted);
  if (!back.honoured) {
    return refuse(
      REFUSAL_REASON.refusedByPlayer,
      `This device would not ${muted ? 'mute' : 'unmute'} playback.`,
    );
  }
  return ok({ muted: back.applied });
}
