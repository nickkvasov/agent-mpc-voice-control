import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { refuse, type ToolRefusal } from '../mcp/result.ts';

/**
 * FR-014: a command the player refuses during an advertisement is reported as
 * deferred, never accepted and dropped.
 *
 * Advertisements are outside this system's control. They are reported, worked
 * around and waited out — never suppressed.
 */
export interface AdState {
  readonly adPlaying: boolean;
}

export function refuseDuringAd(action: string): ToolRefusal {
  return refuse(
    REFUSAL_REASON.adInProgress,
    `An advertisement is playing, and the player will not ${action} until it ends. Ask again once it finishes.`,
    true,
  );
}

export function gateForAd<T>(state: AdState, action: string, run: () => T): T | ToolRefusal {
  return state.adPlaying ? refuseDuringAd(action) : run();
}
