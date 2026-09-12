import { invert } from '../activity/undo.ts';
import type { Effect } from '../activity/effects.ts';

/**
 * Applying an undo to the person's annotations.
 *
 * Labels and tags are reversible, so their entries are offered — which means
 * their inverses must actually exist. Recording the effect without a path to
 * apply it offered an Undo that then refused, which FR-044 forbids outright
 * (Gate B).
 */
export interface Annotation {
  readonly label: string | null;
  readonly tags: readonly string[];
}

export type Annotations = ReadonlyMap<string, Annotation>;

export function applyAnnotationUndo(current: Annotations, effect: Effect): Annotations | null {
  const inverse = invert(effect);

  if (inverse.kind === 'label') {
    const existing = current.get(inverse.videoId) ?? { label: null, tags: [] };
    if (existing.label === inverse.to) return null;
    const next = new Map(current);
    next.set(inverse.videoId, { ...existing, label: inverse.to });
    return next;
  }

  if (inverse.kind === 'tag') {
    const existing = current.get(inverse.videoId) ?? { label: null, tags: [] };
    const has = existing.tags.includes(inverse.tag);
    if (inverse.added === has) return null;
    const tags = inverse.added ? [...existing.tags, inverse.tag] : existing.tags.filter((t) => t !== inverse.tag);
    const next = new Map(current);
    next.set(inverse.videoId, { ...existing, tags });
    return next;
  }

  return null;
}
