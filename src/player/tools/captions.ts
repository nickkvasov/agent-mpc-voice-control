import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import type { CaptionTrack, YouTubePlayer } from '../player.ts';

/**
 * Captions.
 *
 * The T007 spike measured this surface rather than reading it: the public
 * reference documents only `fontSize` and `reload`, but `loadModule('captions')`,
 * `getOption('captions','tracklist')` and `setOption('captions','track',…)` all
 * work. Enabling reads back. **Disabling does not.**
 *
 * For `enabled:false` this returns a refusal whose detail says what was and was
 * not established — codex's own fallback when a contract forbids a third
 * outcome (NOTES.md, 2026-09-12). It is NOT a claim that captions stayed on.
 */
export const CAPTIONS_MODULE = 'captions';

export function listTracks(p: YouTubePlayer): ToolResult<{ tracks: readonly CaptionTrack[] }> {
  p.loadModule(CAPTIONS_MODULE);
  const raw = p.getOption(CAPTIONS_MODULE, 'tracklist');
  if (raw === undefined || raw === null) {
    // NOT the same as an empty list. The module may still be loading, or the
    // undocumented enumeration may be unavailable here. Telling the person the
    // video has no captions would be a confident wrong answer (Constitution IV).
    return refuse(
      REFUSAL_REASON.effectUnverifiable,
      'The player has not reported this video\'s caption tracks yet, so whether it has any is not established.',
    );
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    // FR-010 acceptance 5: say none are available rather than appearing to succeed.
    return refuse(
      REFUSAL_REASON.capabilityUnsupported,
      'This video offers no caption tracks.',
    );
  }
  const tracks = raw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      languageCode: String(t['languageCode'] ?? ''),
      displayName: String(t['displayName'] ?? t['languageName'] ?? t['languageCode'] ?? ''),
    }))
    .filter((t) => t.languageCode !== '');
  return tracks.length === 0
    ? refuse(REFUSAL_REASON.capabilityUnsupported, 'This video reports caption tracks with no usable language codes.')
    : ok({ tracks });
}

export interface CaptionsValue {
  readonly enabled: true;
  readonly track: string;
  readonly verified: true;
}

export function setCaptions(
  p: YouTubePlayer,
  input: { enabled: boolean; track?: string },
): ToolResult<CaptionsValue> {
  if (!input.enabled) {
    p.setOption(CAPTIONS_MODULE, 'track', {});
    p.unloadModule(CAPTIONS_MODULE);
    return refuse(
      REFUSAL_REASON.effectUnverifiable,
      'Sent the request to turn captions off; could not confirm whether captions are now off. The player reports the selected track, not whether captions are displayed.',
    );
  }

  const available = listTracks(p);
  if (!available.ok) return available;

  const wanted = input.track ?? available.value.tracks[0]?.languageCode;
  if (wanted === undefined) {
    return refuse(REFUSAL_REASON.capabilityUnsupported, 'This video offers no caption track to turn on.');
  }
  if (!available.value.tracks.some((t) => t.languageCode === wanted)) {
    return refuse(
      REFUSAL_REASON.noSuchVideo,
      `This video has no ${wanted} caption track. It offers: ${available.value.tracks.map((t) => t.displayName).join(', ')}.`,
    );
  }

  p.setOption(CAPTIONS_MODULE, 'track', { languageCode: wanted });
  const back = p.getOption(CAPTIONS_MODULE, 'track');
  const applied = typeof back === 'object' && back !== null ? String((back as Record<string, unknown>)['languageCode'] ?? '') : '';
  if (applied !== wanted) {
    return refuse(
      REFUSAL_REASON.refusedByPlayer,
      `Asked for the ${wanted} caption track; the player reports ${applied === '' ? 'none' : applied}.`,
    );
  }
  return ok({ enabled: true, track: applied, verified: true });
}
