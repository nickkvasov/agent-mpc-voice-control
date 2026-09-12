import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import type { PlayerState } from '../../vocab/player-states.ts';
import { playerState, type YouTubePlayer } from '../player.ts';
import { gateForAd } from '../ad-gate.ts';
import { settleUntil } from '../readback.ts';
import type { PlaybackContext } from './transport.ts';

export interface SeekValue {
  readonly requestedSeconds: number;
  /** Where playback actually landed — clamped, and reported rather than assumed. */
  readonly positionSeconds: number;
  readonly clamped: boolean;
  readonly state: PlayerState;
}

export type SeekMode = 'absolute' | 'relative';

export async function seek(p: YouTubePlayer, ctx: PlaybackContext, mode: SeekMode, seconds: number, timeoutMs?: number): Promise<ToolResult<SeekValue>> {
  return gateForAd(ctx, 'seek', async () => {
    if (!Number.isFinite(seconds)) {
      return refuse(REFUSAL_REASON.argumentsInvalid, `${String(seconds)} is not a number of seconds.`);
    }
    // `unstarted` does not mean "no video" — see PlaybackContext.
    if (!ctx.hasVideo) {
      return refuse(REFUSAL_REASON.notPlaying, 'There is no video loaded, so there is nowhere to seek to.');
    }
    const duration = p.getDuration();
    const target = mode === 'absolute' ? seconds : p.getCurrentTime() + seconds;
    const clampedTarget = Math.max(0, duration > 0 ? Math.min(target, duration) : Math.max(target, 0));
    p.seekTo(clampedTarget, true);
    // Verified, not assumed: an ignored seek would otherwise return the
    // unchanged position as a success (Gate C).
    const landed = await settleUntil(() => Math.abs(p.getCurrentTime() - clampedTarget) < 1.5, timeoutMs);
    if (!landed) {
      return refuse(
        REFUSAL_REASON.refusedByPlayer,
        `Asked to seek to ${String(Math.round(clampedTarget))}s; the player is at ${String(Math.round(p.getCurrentTime()))}s, so the move was not established.`,
      );
    }
    return ok({
      requestedSeconds: target,
      positionSeconds: p.getCurrentTime(),
      clamped: clampedTarget !== target,
      state: playerState(p),
    });
  });
}
