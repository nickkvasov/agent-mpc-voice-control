import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import { PLAYER_STATE, type PlayerState } from '../../vocab/player-states.ts';
import { playerState, type YouTubePlayer } from '../player.ts';
import { gateForAd, type AdState } from '../ad-gate.ts';

export interface SeekValue {
  readonly requestedSeconds: number;
  /** Where playback actually landed — clamped, and reported rather than assumed. */
  readonly positionSeconds: number;
  readonly clamped: boolean;
  readonly state: PlayerState;
}

export type SeekMode = 'absolute' | 'relative';

export function seek(p: YouTubePlayer, ad: AdState, mode: SeekMode, seconds: number): ToolResult<SeekValue> {
  return gateForAd(ad, 'seek', () => {
    if (!Number.isFinite(seconds)) {
      return refuse(REFUSAL_REASON.argumentsInvalid, `${String(seconds)} is not a number of seconds.`);
    }
    if (playerState(p) === PLAYER_STATE.unstarted) {
      return refuse(REFUSAL_REASON.notPlaying, 'There is no video loaded, so there is nowhere to seek to.');
    }
    const duration = p.getDuration();
    const target = mode === 'absolute' ? seconds : p.getCurrentTime() + seconds;
    const clampedTarget = Math.max(0, duration > 0 ? Math.min(target, duration) : Math.max(target, 0));
    p.seekTo(clampedTarget, true);
    return ok({
      requestedSeconds: target,
      positionSeconds: p.getCurrentTime(),
      clamped: clampedTarget !== target,
      state: playerState(p),
    });
  });
}
