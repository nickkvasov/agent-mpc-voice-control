import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import { PLAYER_STATE, type PlayerState } from '../../vocab/player-states.ts';
import { playerState, type YouTubePlayer } from '../player.ts';
import { gateForAd, type AdState } from '../ad-gate.ts';

export interface TransportValue {
  readonly state: PlayerState;
  readonly positionSeconds: number;
}

const NOTHING_CUED: readonly PlayerState[] = [PLAYER_STATE.unstarted];

function snapshot(p: YouTubePlayer): TransportValue {
  return { state: playerState(p), positionSeconds: p.getCurrentTime() };
}

export function play(p: YouTubePlayer, ad: AdState): ToolResult<TransportValue> {
  return gateForAd(ad, 'start playback', () => {
    if (NOTHING_CUED.includes(playerState(p))) {
      return refuse(REFUSAL_REASON.notPlaying, 'There is no video cued, so there is nothing to play.');
    }
    p.playVideo();
    return ok(snapshot(p));
  });
}

export function pause(p: YouTubePlayer, ad: AdState): ToolResult<TransportValue> {
  return gateForAd(ad, 'pause', () => {
    if (playerState(p) !== PLAYER_STATE.playing) {
      // FR-006 acceptance 6: say nothing is playing rather than failing silently.
      return refuse(REFUSAL_REASON.notPlaying, 'Nothing is playing right now, so there is nothing to pause.');
    }
    p.pauseVideo();
    return ok(snapshot(p));
  });
}

export function stop(p: YouTubePlayer, ad: AdState): ToolResult<TransportValue> {
  return gateForAd(ad, 'stop', () => {
    p.stopVideo();
    return ok(snapshot(p));
  });
}
