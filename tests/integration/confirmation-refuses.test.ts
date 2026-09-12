import { describe, expect, it } from 'vitest';
import { resolveConfirmation, resolveCountedConfirmation } from '../../src/mcp/confirmation-resolver.ts';

/** Constitution VI / FR-028: an unclear response is a refusal, never an assumption. */
describe('confirmation resolver', () => {
  it('accepts only explicit affirmatives', () => {
    for (const yes of ['yes', 'Yes.', 'confirm', 'go ahead', 'OK']) {
      expect(resolveConfirmation(yes)).toBe('confirmed');
    }
  });

  it('treats anything unclear as a refusal', () => {
    for (const unclear of ['maybe', 'i think so', 'sure why not', '', '   ', 'no', 'wait', null, undefined]) {
      expect(resolveConfirmation(unclear)).toBe('refused');
    }
  });

  it('requires the count to be said back for a bulk action', () => {
    // An affirmative alone is not enough: someone who misheard the number would
    // say "yes" just as readily.
    expect(resolveCountedConfirmation('yes', 40)).toBe('refused');
    expect(resolveCountedConfirmation('confirm', 40)).toBe('refused');
    // The wrong count is a refusal, not a near miss.
    expect(resolveCountedConfirmation('yes, all 4', 40)).toBe('refused');
  });

  it('accepts a clear counted confirmation, however it is phrased', () => {
    expect(resolveCountedConfirmation('yes, all 40', 40)).toBe('confirmed');
    expect(resolveCountedConfirmation('40', 40)).toBe('confirmed');
    expect(resolveCountedConfirmation('ok 40', 40)).toBe('confirmed');
  });

  it('refuses when the count appears inside a negation', () => {
    expect(resolveCountedConfirmation('no, not 40', 40)).toBe('refused');
    expect(resolveCountedConfirmation('wait, 40?', 40)).toBe('refused');
  });
});
