/**
 * GET /api/catalog/videos — proxies videos.list (1 unit, effectively
 * unconstrained next to the 100/day search ceiling).
 *
 * Returns duration, captions availability and chapters. Any of the latter two
 * may come back `unknown`, and the contract forbids substituting `false`: not
 * knowing whether a video has captions is a different fact from knowing it has
 * none (Constitution IV).
 */
export const UNKNOWN = 'unknown' as const;

export interface VideoDetails {
  readonly videoId: string;
  readonly durationSeconds: number;
  readonly hasCaptions: boolean | typeof UNKNOWN;
  readonly chapters: readonly { title: string; startSeconds: number }[] | typeof UNKNOWN;
}

/**
 * Parses YouTube's ISO-8601 duration. Returns `undefined` for a shape it does
 * not recognise rather than zero — a zero-length video is a claim, and a
 * failed parse is not evidence for it.
 */
export function parseIso8601Duration(value: string): number | undefined {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (m === null) return undefined;
  const [, d, h, min, s] = m;
  const total =
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return total;
}
