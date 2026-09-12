import { describe, expect, it } from 'vitest';
import { applyAnnotationUndo, type Annotations } from '../../src/curation/annotation-restore.ts';
import type { Effect } from '../../src/activity/effects.ts';

/**
 * FR-044 forbids offering an undo that cannot be performed. Labels and tags
 * are reversible, so their entries ARE offered — which means these inverses
 * must exist. Recording the effect without this path offered an Undo that then
 * refused (Gate B).
 */
const map = (entries: [string, { label: string | null; tags: readonly string[] }][]): Annotations => new Map(entries);

describe('annotation undo', () => {
  it('puts a previous label back', () => {
    const effect: Effect = { kind: 'label', videoId: 'v1', from: null, to: 'Q3 retro' };
    const after = applyAnnotationUndo(map([['v1', { label: 'Q3 retro', tags: [] }]]), effect);
    expect(after?.get('v1')?.label).toBeNull();
  });

  it('restores an earlier label rather than clearing it', () => {
    const effect: Effect = { kind: 'label', videoId: 'v1', from: 'Old', to: 'New' };
    const after = applyAnnotationUndo(map([['v1', { label: 'New', tags: [] }]]), effect);
    expect(after?.get('v1')?.label).toBe('Old');
  });

  it('removes a tag that was added', () => {
    const effect: Effect = { kind: 'tag', videoId: 'v1', tag: 'onboarding', added: true };
    const after = applyAnnotationUndo(map([['v1', { label: null, tags: ['onboarding'] }]]), effect);
    expect(after?.get('v1')?.tags).toEqual([]);
  });

  it('puts back a tag that was removed', () => {
    const effect: Effect = { kind: 'tag', videoId: 'v1', tag: 'onboarding', added: false };
    const after = applyAnnotationUndo(map([['v1', { label: null, tags: [] }]]), effect);
    expect(after?.get('v1')?.tags).toEqual(['onboarding']);
  });

  it('returns null when nothing would change, so the caller refuses', () => {
    const effect: Effect = { kind: 'label', videoId: 'v1', from: null, to: 'Q3' };
    // Already back to null.
    expect(applyAnnotationUndo(map([['v1', { label: null, tags: [] }]]), effect)).toBeNull();
  });

  it('ignores effects that are not annotations', () => {
    const effect: Effect = { kind: 'collection_existence', collectionId: 'c1', created: true };
    expect(applyAnnotationUndo(map([]), effect)).toBeNull();
  });
});
