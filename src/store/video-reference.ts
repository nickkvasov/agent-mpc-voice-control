import { AVAILABILITY, type Availability, isAvailability } from '../vocab/availability.ts';

/**
 * `unknown` is a value, not a missing one (Constitution IV).
 *
 * A fact this system has not established must be distinguishable from a known
 * negative. "This video has no captions" and "I have not checked" are different
 * statements and only one of them is safe to act on, so the type refuses to let
 * them collapse into `false`.
 */
export const UNKNOWN = 'unknown' as const;
export type Unknown = typeof UNKNOWN;
export type Known<T> = T | Unknown;

export function isUnknown<T>(value: Known<T>): value is Unknown {
  return value === UNKNOWN;
}

export interface Chapter {
  readonly title: string;
  readonly startSeconds: number;
}

export interface VideoReference {
  /** Identity, owned by YouTube. */
  readonly videoId: string;
  /** Cached facts owned by YouTube — never edited here. */
  readonly title: string;
  readonly channelTitle: string;
  readonly durationSeconds: number;
  readonly publishedAt: number;
  readonly hasCaptions: Known<boolean>;
  readonly chapters: Known<readonly Chapter[]>;
  readonly cachedAt: number;
  /** Owned by the person — never sent to YouTube (FR-025). */
  readonly label: string | null;
  readonly tags: readonly string[];
  readonly lastPositionSeconds: number;
  readonly availability: Availability;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export class InvalidVideoReference extends Error {}

/**
 * Validates rather than coerces. A malformed reference is refused loudly; an
 * unestablished fact is stored as `unknown`, never defaulted (IMMUNE-U).
 */
export function makeVideoReference(input: {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  publishedAt: number;
  hasCaptions?: Known<boolean>;
  chapters?: Known<readonly Chapter[]>;
  label?: string | null;
  tags?: readonly string[];
  lastPositionSeconds?: number;
  availability?: Availability;
}): VideoReference {
  if (!VIDEO_ID.test(input.videoId)) {
    throw new InvalidVideoReference(`Not a YouTube video id: ${JSON.stringify(input.videoId)}`);
  }
  if (input.durationSeconds < 0) {
    throw new InvalidVideoReference(`Negative duration for ${input.videoId}`);
  }
  if (input.label !== undefined && input.label !== null && input.label.trim() === '') {
    throw new InvalidVideoReference('An empty label must be null, not ""');
  }
  const availability = input.availability ?? AVAILABILITY.unknown;
  if (!isAvailability(availability)) {
    throw new InvalidVideoReference(`Unknown availability ${String(availability)}`);
  }
  return {
    videoId: input.videoId,
    title: input.title,
    channelTitle: input.channelTitle,
    durationSeconds: input.durationSeconds,
    publishedAt: input.publishedAt,
    hasCaptions: input.hasCaptions ?? UNKNOWN,
    chapters: input.chapters ?? UNKNOWN,
    cachedAt: Date.now(),
    label: input.label ?? null,
    tags: input.tags ?? [],
    lastPositionSeconds: input.lastPositionSeconds ?? 0,
    availability,
  };
}
