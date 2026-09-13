import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import { BULK_THRESHOLD } from '../vocab/tool-names.ts';
import { ok, refuse, type ToolResult } from '../mcp/result.ts';
import type { VideoReference } from '../store/video-reference.ts';

/**
 * Tags and labels — the person's own annotations.
 *
 * FR-025: these never alter the video at its source. A label is a personal
 * display name shown INSTEAD of the title here; the title itself is a cached
 * fact owned by YouTube and is never written. Every result says so explicitly,
 * so the guarantee is observable rather than merely intended.
 */
export interface LabelResult {
  readonly videoId: string;
  readonly label: string | null;
  readonly previousLabel: string | null;
  /** Asserted in the result so FR-025 can be checked, not just trusted. */
  readonly sourceTitleUnchanged: true;
  readonly sourceTitle: string;
}

export function setLabel(video: VideoReference, label: string | null): ToolResult<LabelResult> {
  const next = label === null ? null : label.trim();
  if (next !== null && next === '') {
    // Clearing is `null`; an empty string would be a label that displays as
    // nothing, which reads as a bug rather than as "no label".
    return refuse(REFUSAL_REASON.argumentsInvalid, 'An empty label is not a name. Clear it instead to go back to the video\'s own title.');
  }
  if (next === video.label) {
    return refuse(
      REFUSAL_REASON.argumentsInvalid,
      next === null ? 'That video has no label already.' : `That video is already labelled "${next}".`,
    );
  }
  return ok({
    videoId: video.videoId,
    label: next,
    previousLabel: video.label,
    sourceTitleUnchanged: true,
    sourceTitle: video.title,
  });
}

export interface TagResult {
  readonly videoIds: readonly string[];
  readonly tag: string;
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
}

function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function addTag(
  videos: readonly VideoReference[],
  tag: string,
  confirmedCount?: number,
): ToolResult<TagResult> {
  const t = normaliseTag(tag);
  if (t === '') return refuse(REFUSAL_REASON.argumentsInvalid, 'A tag needs some text.');
  const changed = videos.filter((v) => !v.tags.includes(t)).map((v) => v.videoId);
  const unchanged = videos.filter((v) => v.tags.includes(t)).map((v) => v.videoId);
  if (changed.length === 0) {
    return refuse(
      REFUSAL_REASON.argumentsInvalid,
      videos.length === 1 ? `That video is already tagged "${t}".` : `All ${String(videos.length)} are already tagged "${t}".`,
    );
  }
  if (changed.length > BULK_THRESHOLD && confirmedCount !== changed.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would tag ${String(changed.length)} videos "${t}". Confirm that count to go ahead.`,
    );
  }
  return ok({ videoIds: videos.map((v) => v.videoId), tag: t, changed, unchanged });
}

export function removeTag(
  videos: readonly VideoReference[],
  tag: string,
  confirmedCount?: number,
): ToolResult<TagResult> {
  const t = normaliseTag(tag);
  if (t === '') return refuse(REFUSAL_REASON.argumentsInvalid, 'A tag needs some text.');
  const changed = videos.filter((v) => v.tags.includes(t)).map((v) => v.videoId);
  const unchanged = videos.filter((v) => !v.tags.includes(t)).map((v) => v.videoId);
  if (changed.length === 0) {
    return refuse(REFUSAL_REASON.noSuchVideo, `None of those are tagged "${t}".`);
  }
  if (changed.length > BULK_THRESHOLD && confirmedCount !== changed.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would untag ${String(changed.length)} videos. Confirm that count to go ahead.`,
    );
  }
  return ok({ videoIds: videos.map((v) => v.videoId), tag: t, changed, unchanged });
}

export interface TagPlan {
  readonly tags: readonly string[];
  /** Each changed video's complete tag list after the batch. */
  readonly next: readonly { readonly videoId: string; readonly tags: readonly string[] }[];
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
}

/**
 * A whole tag batch, planned before anything changes (Phase 9 Gate C).
 *
 * Applying tags one at a time let a later refusal leave earlier tags in place
 * while the record said the call failed, and read-after-write through React
 * state lost all but the last tag. Planning first means the batch applies
 * whole or not at all, and each video is written once with its final tags.
 * A tag already present on a video is not a refusal — nothing about that video
 * needs to change for that tag — unless nothing in the batch changes at all.
 */
export function planTags(
  videos: readonly VideoReference[],
  tags: readonly string[],
  adding: boolean,
  confirmedCount?: number,
): ToolResult<TagPlan> {
  const plan = previewTags(videos, tags, adding);
  if (!plan.ok) return plan;
  const { changed } = plan.value;
  if (changed.length > BULK_THRESHOLD && confirmedCount !== changed.length) {
    return refuse(
      REFUSAL_REASON.needsConfirmation,
      `That would ${adding ? 'tag' : 'untag'} ${String(changed.length)} videos. Confirm that count to go ahead.`,
    );
  }
  return plan;
}

/**
 * What a tag batch would change, WITHOUT the confirmation gate — for asking the
 * person how many videos will change before they are asked to confirm it.
 * Passing an impossible confirmed count to `planTags` instead refused every
 * bulk preview, so nobody was ever asked and bulk tagging could not succeed
 * (Phase 9 Gate C round 2).
 */
export function previewTags(
  videos: readonly VideoReference[],
  tags: readonly string[],
  adding: boolean,
): ToolResult<TagPlan> {
  const normalised = [...new Set(tags.map(normaliseTag))];
  if (normalised.length === 0 || normalised.some((t) => t === '')) {
    return refuse(REFUSAL_REASON.argumentsInvalid, 'Every tag needs some text; nothing was changed.');
  }
  const next: { videoId: string; tags: readonly string[] }[] = [];
  for (const v of videos) {
    const after = adding
      ? [...v.tags, ...normalised.filter((t) => !v.tags.includes(t))]
      : v.tags.filter((t) => !normalised.includes(t));
    if (after.length !== v.tags.length) next.push({ videoId: v.videoId, tags: after });
  }
  const changed = next.map((n) => n.videoId);
  const unchanged = videos.map((v) => v.videoId).filter((id) => !changed.includes(id));
  const quoted = normalised.map((t) => `"${t}"`).join(', ');
  if (changed.length === 0) {
    return adding
      ? refuse(REFUSAL_REASON.argumentsInvalid, videos.length === 1 ? `That video is already tagged ${quoted}.` : `All of them are already tagged ${quoted}.`)
      : refuse(REFUSAL_REASON.noSuchVideo, `None of those are tagged ${quoted}.`);
  }
  return ok({ tags: normalised, next, changed, unchanged });
}

/** What the interface shows for a video: the person's label, else the source title. */
export function displayName(video: VideoReference): { readonly shown: string; readonly isPersonal: boolean } {
  return video.label === null ? { shown: video.title, isPersonal: false } : { shown: video.label, isPersonal: true };
}
