import { describe, expect, it } from 'vitest';
import { deriveConnection } from '../../src/mcp/connection-status.tsx';

/** T134 — what the page shows about the assistant, from what is actually true (FR-037, FR-046). */
const NOW = 1_000_000;

describe('assistant availability shown on the page', () => {
  it('connected only when the connection is', () => {
    expect(deriveConnection({ status: 'connected', connectedAt: 1 }, null, NOW)).toEqual({ state: 'connected', reason: null });
  });

  it('connecting and reconnecting both read as connecting', () => {
    expect(deriveConnection({ status: 'connecting' }, null, NOW).state).toBe('connecting');
    expect(deriveConnection({ status: 'reconnecting', attempt: 2 }, null, NOW).state).toBe('connecting');
  });

  it('an error is unavailable with the error\'s own reason', () => {
    const r = deriveConnection({ status: 'error', error: new Error('No connection ticket (503): The agent host has no credential configured.') }, null, NOW);
    expect(r.state).toBe('unavailable');
    expect(r.reason).toContain('no credential');
  });

  it('disconnected is unavailable with a reason, never a blank', () => {
    const r = deriveConnection({ status: 'disconnected' }, null, NOW);
    expect(r).toMatchObject({ state: 'unavailable' });
    expect(r.reason?.trim()).not.toBe('');
  });

  it('a spent allowance makes it unavailable until it resets, naming the limit — even while connected', () => {
    const spent = { reason: 'assistant_allowance_spent', detail: 'This session has used its 40 assistant turns.', limit: 'session' as const, resetsAt: NOW + 3_600_000 };
    const r = deriveConnection({ status: 'connected', connectedAt: 1 }, spent, NOW);
    expect(r.state).toBe('unavailable');
    expect(r.reason).toContain('40 assistant turns');
    expect(r.reason).toMatch(/available again/);
    // After the reset time the refusal no longer applies.
    expect(deriveConnection({ status: 'connected', connectedAt: 1 }, spent, spent.resetsAt + 1).state).toBe('connected');
  });
});
