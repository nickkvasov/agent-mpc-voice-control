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
  | { readonly kind: 'collection_member'; readonly collectionId: string; readonly videoId: string; readonly added: boolean }
  | { readonly kind: 'collection_name'; readonly collectionId: string; readonly from: string; readonly to: string }
  | { readonly kind: 'collection_existence'; readonly collectionId: string; readonly created: boolean }
  | {
      readonly kind: 'queue_occurrence';
      readonly entryId: string;
      readonly added: boolean;
      /**
       * Enough to put it BACK. A removal's inverse needs the video and where it
       * sat; without them Undo could be offered and never restore anything.
       *
       * TWO anchors, not a numeric index: the entry it followed and the one it
       * preceded. A saved index goes stale the moment anything before it moves
       * — with [A,B,C], removing B then A and undoing both rebuilt [A,C,B].
       * One anchor is not enough either: when B is restored, A is still absent,
       * so the trailing anchor (C) is what puts B back in the right place.
       * `null` on either side means it was at that end. The index survives only
       * as a last resort when both anchors are gone.
       */
      readonly videoId: string;
      readonly index: number;
      readonly afterEntryId: string | null;
      readonly beforeEntryId: string | null;
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
