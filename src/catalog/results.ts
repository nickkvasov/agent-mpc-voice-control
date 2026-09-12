import type { VideoReference } from '../store/video-reference.ts';

/**
 * The current result set and the criteria that produced it.
 *
 * FR-021 requires every result-returning call to state the criteria it applied,
 * so criteria live WITH the results rather than being reconstructed by whoever
 * displays them.
 */
export interface Criteria {
  readonly query?: string;
  readonly publishedAfter?: number;
  readonly publishedBefore?: number;
  readonly maxDurationSeconds?: number;
  readonly minDurationSeconds?: number;
  readonly titleContains?: string;
}

/** Which operation actually happened — emitted by the code that did it. */
export type ResultOperation = 'fresh_search' | 'narrowed' | 'unchanged' | 'read';

export interface ResultSet {
  readonly items: readonly VideoReference[];
  readonly criteria: Criteria;
  readonly operation: ResultOperation;
  /** True when these came from cache rather than a fresh call. */
  readonly fromCache: boolean;
}

export const EMPTY: ResultSet = { items: [], criteria: {}, operation: 'read', fromCache: false };

/**
 * Applies narrowing predicates locally. Never falls back to searching: narrow
 * and search mean different things, and substituting one answers a question
 * nobody asked (NOTES.md 2026-09-12).
 */
export function narrowLocally(current: ResultSet, add: Criteria): ResultSet {
  const merged: Criteria = { ...current.criteria, ...add };
  const items = current.items.filter((v) => matches(v, add));
  const changed = Object.keys(add).some((k) => (add as Record<string, unknown>)[k] !== (current.criteria as Record<string, unknown>)[k]);
  return {
    items,
    criteria: merged,
    // A filter that leaves the same videos visible is still a change of
    // criteria — `unchanged` means the CRITERIA repeated, not the set.
    operation: changed ? 'narrowed' : 'unchanged',
    fromCache: current.fromCache,
  };
}

function matches(v: VideoReference, c: Criteria): boolean {
  if (c.maxDurationSeconds !== undefined && v.durationSeconds > c.maxDurationSeconds) return false;
  if (c.minDurationSeconds !== undefined && v.durationSeconds < c.minDurationSeconds) return false;
  if (c.publishedAfter !== undefined && v.publishedAt < c.publishedAfter) return false;
  if (c.publishedBefore !== undefined && v.publishedAt > c.publishedBefore) return false;
  if (c.titleContains !== undefined && !v.title.toLowerCase().includes(c.titleContains.toLowerCase())) return false;
  return true;
}

/** Plain-language description of the criteria in force (FR-021). */
export function describeCriteria(c: Criteria): string {
  const parts: string[] = [];
  if (c.query !== undefined) parts.push(`matching "${c.query}"`);
  if (c.titleContains !== undefined) parts.push(`with "${c.titleContains}" in the title`);
  if (c.maxDurationSeconds !== undefined) parts.push(`under ${String(Math.round(c.maxDurationSeconds / 60))} minutes`);
  if (c.minDurationSeconds !== undefined) parts.push(`over ${String(Math.round(c.minDurationSeconds / 60))} minutes`);
  if (c.publishedAfter !== undefined) parts.push(`published after ${new Date(c.publishedAfter).toISOString().slice(0, 10)}`);
  if (c.publishedBefore !== undefined) parts.push(`published before ${new Date(c.publishedBefore).toISOString().slice(0, 10)}`);
  return parts.length === 0 ? 'no filters' : parts.join(', ');
}
