/**
 * What an action actually did, in terms of stable identities.
 *
 * Undo eligibility is decided by comparing effects, so an effect must name the
 * thing it touched precisely enough that a later action can be seen to consume
 * it. Sharing a container is deliberately NOT enough: two additions to one
 * collection are independent, and treating them as related would disable undo
 * almost everywhere (NOTES.md 2026-09-12).
 */
export const EFFECT = {
  collectionMember: 'collection_member',
  collectionName: 'collection_name',
  collectionExistence: 'collection_existence',
  queueOccurrence: 'queue_occurrence',
  tag: 'tag',
  label: 'label',
} as const;

export type EffectKind = (typeof EFFECT)[keyof typeof EFFECT];

export type Effect =
  | {
      readonly kind: 'collection_member';
      readonly collectionId: string;
      readonly videoId: string;
      readonly added: boolean;
      /**
       * Where it sat. Collections are ordered, so restoring by appending put a
       * member back in the wrong place: [a,b,c] minus a, undone, became
       * [b,c,a] (Gate C) — the same positional lesson the queue taught, which I
       * failed to carry across.
       *
       * Known limitation: restoring SEVERAL removed members out of their
       * removal order can still misplace them, because each index was taken
       * against a different array. The queue solved this with a permanent sort
       * key; collections hold bare ids and would need the same treatment.
       * Recorded in tasks.md rather than left to be discovered.
       */
      readonly index: number;
    }
  | { readonly kind: 'collection_name'; readonly collectionId: string; readonly from: string; readonly to: string }
  | { readonly kind: 'collection_existence'; readonly collectionId: string; readonly created: boolean }
  | {
      readonly kind: 'queue_occurrence';
      readonly entryId: string;
      readonly added: boolean;
      /** Enough to put it back exactly where it was, in any undo order. */
      readonly videoId: string;
      readonly order: number;
    }
  | { readonly kind: 'tag'; readonly videoId: string; readonly tag: string; readonly added: boolean }
  | { readonly kind: 'label'; readonly videoId: string; readonly from: string | null; readonly to: string | null };

/** The identity an effect touches — two effects on the same identity interact. */
export function identityOf(e: Effect): string {
  switch (e.kind) {
    case 'collection_member':
      return `member:${e.collectionId}:${e.videoId}`;
    case 'collection_name':
    case 'collection_existence':
      return `collection:${e.collectionId}`;
    case 'queue_occurrence':
      return `queue:${e.entryId}`;
    case 'tag':
      return `tag:${e.videoId}:${e.tag}`;
    case 'label':
      return `label:${e.videoId}`;
  }
}

/** The container an effect lives inside, where losing it destroys the identity. */
export function containerOf(e: Effect): string | null {
  switch (e.kind) {
    case 'collection_member':
      return `collection:${e.collectionId}`;
    default:
      return null;
  }
}
