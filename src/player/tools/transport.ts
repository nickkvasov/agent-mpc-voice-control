import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import { PLAYER_STATE, type PlayerState } from '../../vocab/player-states.ts';
import { playerState, type YouTubePlayer } from '../player.ts';
import { gateForAd, type AdState } from '../ad-gate.ts';
import { settleUntil } from '../readback.ts';

export interface TransportValue {
  readonly state: PlayerState;
  readonly positionSeconds: number;
}

/**
 * Whether a video is loaded at all.
 *
 * Tracked separately from transport state because YouTube's `-1` means
 * "not started", NOT "nothing loaded" — a player cued with a video id is
 * legitimately unstarted, and `stopVideo()` can return it to that state. Gate C
 * found the two conflated, which refused `play` on a perfectly good video.
 */
export interface PlaybackContext extends AdState {
  readonly hasVideo: boolean;
}

function snapshot(p: YouTubePlayer): TransportValue {
  return { state: playerState(p), positionSeconds: p.getCurrentTime() };
}

async function verified(
  p: YouTubePlayer,
  want: PlayerState,
  action: string,
  timeoutMs?: number,
): Promise<ToolResult<TransportValue>> {
  const settled = await settleUntil(() => playerState(p) === want, timeoutMs);
  return settled
    ? ok(snapshot(p))
    : refuse(
        REFUSAL_REASON.refusedByPlayer,
        `Asked the player to ${action}; it is still ${playerState(p)}, so the change was not established.`,
      );
}

export async function play(p: YouTubePlayer, ctx: PlaybackContext, timeoutMs?: number): Promise<ToolResult<TransportValue>> {
  return gateForAd(ctx, 'start playback', async () => {
    if (!ctx.hasVideo) {
      return refuse(REFUSAL_REASON.notPlaying, 'There is no video loaded, so there is nothing to play.');
    }
    if (playerState(p) === PLAYER_STATE.playing) return ok(snapshot(p));
    p.playVideo();
    return verified(p, PLAYER_STATE.playing, 'start playback', timeoutMs);
  });
}

export async function pause(p: YouTubePlayer, ctx: PlaybackContext, timeoutMs?: number): Promise<ToolResult<TransportValue>> {
  return gateForAd(ctx, 'pause', async () => {
    if (playerState(p) !== PLAYER_STATE.playing) {
      // FR-006 acceptance 6: say nothing is playing rather than failing silently.
      return refuse(REFUSAL_REASON.notPlaying, 'Nothing is playing right now, so there is nothing to pause.');
    }
    p.pauseVideo();
    return verified(p, PLAYER_STATE.paused, 'pause', timeoutMs);
  });
}

export async function stop(p: YouTubePlayer, ctx: PlaybackContext, timeoutMs?: number): Promise<ToolResult<TransportValue>> {
  return gateForAd(ctx, 'stop', async () => {
    if (!ctx.hasVideo) {
      return refuse(REFUSAL_REASON.notPlaying, 'There is no video loaded, so there is nothing to stop.');
    }
    p.stopVideo();
    // stopVideo may legitimately leave the player ended, unstarted, paused or
    // cued. Insisting on the first two reported a working stop as refused.
    const STOPPED: readonly PlayerState[] = [
      PLAYER_STATE.ended, PLAYER_STATE.unstarted, PLAYER_STATE.paused, PLAYER_STATE.cued,
    ];
    const settled = await settleUntil(() => STOPPED.includes(playerState(p)), timeoutMs);
    return settled
      ? ok(snapshot(p))
      : refuse(REFUSAL_REASON.refusedByPlayer, `Asked the player to stop; it is still ${playerState(p)}.`);
  });
}
