import { describe, expect, it } from 'vitest';
import { UNKNOWN, isUnknown, makeVideoReference, InvalidVideoReference } from '../../src/store/video-reference.ts';
import { AVAILABILITY } from '../../src/vocab/availability.ts';

/**
 * T019 — Constitution IV. Collapsing unknown into false is how a system starts
 * lying without anyone writing a lie.
 */
describe('unknown is a value', () => {
  const base = { videoId: 'M7lc1UVf-VE', title: 'x', channelTitle: 'c', durationSeconds: 10, publishedAt: 0 };

  it('an unestablished captions fact is unknown, not false', () => {
    const v = makeVideoReference(base);
    expect(v.hasCaptions).toBe(UNKNOWN);
    expect(v.hasCaptions).not.toBe(false);
    expect(isUnknown(v.hasCaptions)).toBe(true);
  });

  it('an unestablished chapter list is unknown, not empty', () => {
    const v = makeVideoReference(base);
    expect(v.chapters).toBe(UNKNOWN);
    expect(v.chapters).not.toEqual([]);
  });

  it('distinguishes a known negative from an unknown', () => {
    const known = makeVideoReference({ ...base, hasCaptions: false });
    const unknown = makeVideoReference(base);
    expect(known.hasCaptions).toBe(false);
    expect(isUnknown(known.hasCaptions)).toBe(false);
    expect(isUnknown(unknown.hasCaptions)).toBe(true);
  });

  it('an unfetched availability is unknown, never available', () => {
    expect(makeVideoReference(base).availability).toBe(AVAILABILITY.unknown);
  });

  it('refuses a malformed reference rather than storing it speculatively', () => {
    expect(() => makeVideoReference({ ...base, videoId: 'nope' })).toThrow(InvalidVideoReference);
    expect(() => makeVideoReference({ ...base, durationSeconds: -1 })).toThrow(InvalidVideoReference);
    expect(() => makeVideoReference({ ...base, label: '  ' })).toThrow(InvalidVideoReference);
  });
});
