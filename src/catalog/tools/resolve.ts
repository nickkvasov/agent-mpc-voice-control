import { REFUSAL_REASON } from '../../vocab/refusal-reasons.ts';
import { ok, refuse, type ToolResult } from '../../mcp/result.ts';
import { isUnknown, type VideoReference } from '../../store/video-reference.ts';

/**
 * Resolves "the third one", "the shortest", "the one about launches".
 *
 * FR-018: when more than one item matches, return the candidates and ask —
 * never choose. Guessing here is how an assistant plays the wrong video and
 * looks like it ignored you.
 */
export interface ResolvedOne {
  readonly videoId: string;
  readonly title: string;
  readonly how: string;
}

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1,
};

export function resolveReference(items: readonly VideoReference[], reference: string): ToolResult<ResolvedOne> {
  const r = reference.trim().toLowerCase();
  if (items.length === 0) {
    return refuse(REFUSAL_REASON.noSuchVideo, 'There are no results to choose from yet.');
  }
  if (r === '') {
    return refuse(REFUSAL_REASON.ambiguousReference, 'No reference was given.');
  }

  // A number only denotes a POSITION when the phrase says so. "the one about
  // Apollo 1" used to resolve to result 1, silently playing the wrong video
  // because any digit anywhere outranked the title (Gate C).
  const ordinalWord = Object.keys(ORDINALS).find((w) => new RegExp(`\\b${w}\\b`).test(r));
  // Explicit positional forms only. `#2`, `result #2`, `2nd`, `2nd one`,
  // `the 2nd`, or a bare number — but never a digit that merely appears in a
  // title, which used to outrank the title itself.
  const positional =
    /(?:^|\s)#\s*(\d{1,2})(?=\s|$)/.exec(r) ??
    /(?:\b(?:number|result|item)\s*#?\s*)(\d{1,2})\b/.exec(r) ??
    /(?:^|\s)(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)(?=\s|$)/.exec(r) ??
    /^\s*(\d{1,2})\s*$/.exec(r);
  const index =
    ordinalWord !== undefined
      ? ORDINALS[ordinalWord]
      : positional !== null
        ? Number(positional[1])
        : undefined;
  if (index !== undefined) {
    const item = index === -1 ? items[items.length - 1] : items[index - 1];
    if (item === undefined) {
      return refuse(REFUSAL_REASON.noSuchVideo, `There is no result number ${String(index)}; there are ${String(items.length)}.`);
    }
    return ok({ videoId: item.videoId, title: item.title, how: index === -1 ? 'the last result' : `result ${String(index)}` });
  }

  if (/\bshortest\b/.test(r) || /\blongest\b/.test(r)) {
    const longest = /\blongest\b/.test(r);
    // Comparing against an unknown duration would rank by a fact we do not
    // have. Videos whose length is not established are excluded and counted.
    const known = items.filter((v) => !isUnknown(v.durationSeconds));
    const unknownCount = items.length - known.length;
    if (known.length === 0) {
      return refuse(
        REFUSAL_REASON.effectUnverifiable,
        `No result has an established length yet, so the ${longest ? 'longest' : 'shortest'} cannot be identified.`,
      );
    }
    const dur = (v: VideoReference): number => v.durationSeconds as number;
    const sorted = [...known].sort((a, b) => (longest ? dur(b) - dur(a) : dur(a) - dur(b)));
    const best = sorted[0] as VideoReference;
    const tied = sorted.filter((v) => dur(v) === dur(best));
    if (unknownCount > 0 && tied.length === 1) {
      return ok({
        videoId: best.videoId,
        title: best.title,
        how: `the ${longest ? 'longest' : 'shortest'} of the ${String(known.length)} results whose length is known (${String(unknownCount)} not yet established)`,
      });
    }
    if (tied.length > 1) {
      return refuse(
        REFUSAL_REASON.ambiguousReference,
        `${String(tied.length)} results are equally ${longest ? 'long' : 'short'}: ${tied.map((v) => v.title).join(', ')}. Which one?`,
      );
    }
    return ok({ videoId: best.videoId, title: best.title, how: longest ? 'the longest result' : 'the shortest result' });
  }

  const words = r.split(/\s+/).filter((w) => w.length > 2 && !['the', 'one', 'about', 'play', 'that'].includes(w));
  if (words.length === 0) {
    return refuse(REFUSAL_REASON.ambiguousReference, `"${reference}" does not identify a result.`);
  }
  const scored = items
    .map((v) => ({ v, score: words.filter((w) => v.title.toLowerCase().includes(w)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return refuse(REFUSAL_REASON.noSuchVideo, `Nothing in the current results matches "${reference}".`);
  }
  const top = scored[0]?.score ?? 0;
  const tied = scored.filter((s) => s.score === top);
  if (tied.length > 1) {
    return refuse(
      REFUSAL_REASON.ambiguousReference,
      `"${reference}" matches ${String(tied.length)} results: ${tied.map((s) => s.v.title).join(', ')}. Which one?`,
    );
  }
  const best = scored[0] as { v: VideoReference };
  return ok({ videoId: best.v.videoId, title: best.v.title, how: `the only result matching "${reference}"` });
}
