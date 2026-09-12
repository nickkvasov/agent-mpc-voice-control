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

  // A reference is positional only when the WHOLE phrase denotes a position.
  // Searching anywhere for a positional-looking token meant "the one about
  // Apollo #1" and "the one about 3rd party cookies" both resolved by number
  // and played the wrong video (Gate C). Trailing punctuation is stripped, so
  // "the 2nd." and "the 2nd, please" still work.
  const bare = r
    .replace(/\b(?:the|one|item|result|number|please|just|play)\b/g, ' ')
    // After the filler words, so interior punctuation ("the 2nd, please") goes
    // too. `#` survives deliberately: it is part of "#2".
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // The phrase may end in a noun for the thing being counted — "the second
  // video", "the last clip". Allowed only as a trailing word of an otherwise
  // bare positional phrase, so "the one about video encoding" is still a title
  // reference rather than a position.
  const COUNTED_NOUN = '(?:\\s+(?:video|videos|clip|clips|track|tracks))?';
  const ordinalWord = Object.keys(ORDINALS).find((w) => new RegExp(`^${w}${COUNTED_NOUN}$`).test(bare));
  const positional = new RegExp(`^#?\\s*(\\d{1,2})(?:st|nd|rd|th)?${COUNTED_NOUN}$`).exec(bare);
  const index =
    ordinalWord !== undefined ? ORDINALS[ordinalWord] : positional !== null ? Number(positional[1]) : undefined;

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
