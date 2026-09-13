import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { refuse, type ToolRefusal } from '../mcp/result.ts';
import type { ToolName } from '../vocab/tool-names.ts';

/**
 * FR-035: a capability unavailable because its part of the interface is not
 * open is reported as such, naming what the person would need to open.
 *
 * Tools exist only while the component declaring them is mounted, so "that tool
 * does not exist right now" is an ordinary condition rather than an error — but
 * it must never be reported as a generic failure, which would send someone
 * looking for a bug in a feature that is simply off screen.
 */
export const VIEW_OF_TOOL: Readonly<Record<string, string>> = {
  'playback.': 'the player',
  'catalog.': 'the search results',
  'queue.': 'the queue',
  'curation.': 'the collections panel',
  'activity.': 'the activity record',
};

export function viewOwning(tool: ToolName | string): string | null {
  const prefix = Object.keys(VIEW_OF_TOOL).find((p) => tool.startsWith(p));
  return prefix === undefined ? null : (VIEW_OF_TOOL[prefix] ?? null);
}

export function refuseUnavailableView(tool: ToolName | string): ToolRefusal {
  const view = viewOwning(tool);
  return refuse(
    REFUSAL_REASON.viewNotOpen,
    view === null
      ? `${tool} is not available right now.`
      : `${tool} needs ${view}, which is not open. Open ${view} and try again.`,
  );
}

/**
 * A capability that exists in the interface but has no handler yet.
 *
 * Distinct from a closed view, and it matters: telling someone to open the
 * player when the player is right in front of them recommends an action that
 * cannot resolve anything (Gate C). "Not built yet" and "not on screen" are
 * different facts and must not share a message.
 */
export function refuseUnsupportedCapability(tool: ToolName | string): ToolRefusal {
  return refuse(
    REFUSAL_REASON.capabilityUnsupported,
    `${tool} is not available in this build yet. Nothing was changed.`,
  );
}

/** Whether a tool is currently declared. Absence is a fact, not a failure. */
export function isDeclared(tool: ToolName | string, declared: readonly string[]): boolean {
  return declared.includes(tool);
}
