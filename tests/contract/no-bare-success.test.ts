import { describe, expect, it } from 'vitest';
import { isRefusal, ok, refuse, type ToolResult } from '../../src/mcp/result.ts';
import { REFUSAL_REASON, isRefusalReason } from '../../src/vocab/refusal-reasons.ts';

/**
 * T014 — the contract-wide invariant for Constitution III.
 *
 * One test for the whole tool surface rather than a review item per handler:
 * fixing the mechanism that produces a class of error, not each instance
 * (IMMUNE-M2).
 */
describe('no bare success', () => {
  it('every result is either a value or a named reason — there is no third shape', () => {
    const results: ToolResult<unknown>[] = [
      ok({ position: 120 }),
      refuse(REFUSAL_REASON.notPlaying, 'Nothing is playing right now.'),
    ];
    for (const r of results) {
      if (r.ok) {
        expect(r).toHaveProperty('value');
      } else {
        expect(isRefusalReason(r.reason)).toBe(true);
        expect(r.detail.trim()).not.toBe('');
      }
    }
  });

  it('refuses to construct a refusal with no detail', () => {
    expect(() => refuse(REFUSAL_REASON.notPlaying, '')).toThrow(/no detail/);
    expect(() => refuse(REFUSAL_REASON.notPlaying, '   ')).toThrow(/no detail/);
  });

  it('every refusal reason in the vocabulary is usable and recognised', () => {
    for (const reason of Object.values(REFUSAL_REASON)) {
      const r = refuse(reason, `refused because ${reason}`);
      expect(isRefusal(r)).toBe(true);
      expect(isRefusalReason(r.reason)).toBe(true);
    }
  });

  it('rejects a reason that is not in the closed set', () => {
    expect(isRefusalReason('vibes')).toBe(false);
    expect(isRefusalReason(undefined)).toBe(false);
  });
});
