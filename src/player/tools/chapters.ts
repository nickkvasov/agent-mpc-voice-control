import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import type { Chapter } from '../../store/video-reference.ts';
import { isUnknown, type Known } from '../../store/video-reference.ts';
import type { YouTubePlayer } from '../player.ts';

/**
 * FR-012: seek to a chapter by describing it, and name the chapter resolved to.
 *
 * Chapters come from what the video publishes. Deriving them from audio is out
 * of scope, so the absence of chapters is a stated outcome rather than a
 * failure — and "we have not checked" is distinct from "there are none".
 */
export function seekToChapter(
  p: YouTubePlayer,
  chapters: Known<readonly Chapter[]>,
  query: string,
): ToolResult<{ chapterTitle: string; positionSeconds: number }> {
  if (isUnknown(chapters)) {
    return refuse(
      REFUSAL_REASON.capabilityUnsupported,
      'It is not yet known whether this video publishes chapters, so there is nothing to search.',
    );
  }
  if (chapters.length === 0) {
    return refuse(
      REFUSAL_REASON.capabilityUnsupported,
      'This video publishes no chapters, so a described moment cannot be located. Give a timestamp instead.',
    );
  }
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return refuse(REFUSAL_REASON.argumentsInvalid, 'No chapter description was given.');
  }
  const scored = chapters
    .map((c) => ({ c, score: overlap(c.title.toLowerCase(), needle) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return refuse(
      REFUSAL_REASON.ambiguousReference,
      `No chapter matches "${query}". This video has: ${chapters.map((c) => c.title).join(', ')}.`,
    );
  }
  // A tie is ambiguous, and FR-018 says ask rather than choose.
  if (scored.length > 1 && scored[0]?.score === scored[1]?.score) {
    return refuse(
      REFUSAL_REASON.ambiguousReference,
      `"${query}" matches more than one chapter equally: ${scored.filter((s) => s.score === scored[0]?.score).map((s) => s.c.title).join(', ')}.`,
    );
  }
  const best = scored[0] as { c: Chapter };
  p.seekTo(best.c.startSeconds, true);
  return ok({ chapterTitle: best.c.title, positionSeconds: p.getCurrentTime() });
}

function overlap(title: string, needle: string): number {
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return title.includes(needle) ? 1 : 0;
  return words.filter((w) => title.includes(w)).length;
}
