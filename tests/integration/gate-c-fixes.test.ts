import { describe, expect, it, beforeEach } from 'vitest';
import { CatalogSearch } from '../../server/catalog-proxy/search.ts';
import { SearchBudget } from '../../server/catalog-proxy/budget.ts';
import { mintTicket, __resetTickets, __ticketCount } from '../../server/ticket/route.ts';

/** Regression cover for the Gate C findings on this phase's commit. */
describe('Gate C regressions', () => {
  beforeEach(() => __resetTickets());

  it('reports an unknown quota balance until prior usage is established', () => {
    const q = new SearchBudget();
    expect(q.snapshot().searchCallsRemaining).toBeNull();
    q.restore(7);
    expect(q.snapshot().searchCallsRemaining).toBe(83);
  });

  it('coalesces concurrent identical searches into one call and one unit of quota', async () => {
    let fetches = 0;
    const q = new SearchBudget();
    q.restore(0);
    const s = new CatalogSearch(async () => {
      fetches += 1;
      await new Promise((r) => setTimeout(r, 20));
      return [];
    }, q);
    await Promise.all(Array.from({ length: 5 }, () => s.search({ query: 'state machines' })));
    expect(fetches).toBe(1);
    expect(q.spentToday()).toBe(1);
  });

  it('does not cache a failed search', async () => {
    const q = new SearchBudget();
    q.restore(0);
    let calls = 0;
    const s = new CatalogSearch(async () => {
      calls += 1;
      throw new Error('upstream down');
    }, q);
    await expect(s.search({ query: 'x' })).rejects.toThrow('upstream down');
    await expect(s.search({ query: 'x' })).rejects.toThrow('upstream down');
    expect(calls).toBe(2);
  });

  it('evicts expired and used tickets rather than retaining every one minted', () => {
    for (let i = 0; i < 5; i++) mintTicket('wss://gw.example');
    expect(__ticketCount()).toBeLessThanOrEqual(5);
  });
});
