import { describe, expect, it } from 'vitest';
import { handle, parseIso8601Duration } from '../../server/routes.ts';
import { CatalogSearch } from '../../server/catalog-proxy/search.ts';
import { SearchBudget } from '../../server/catalog-proxy/budget.ts';
import { __resetTickets, redeemTicket } from '../../server/ticket/route.ts';

function deps(over: Partial<Parameters<typeof handle>[2]> = {}) {
  const budget = new SearchBudget();
  budget.restore(0);
  return {
    gatewayOrigin: 'wss://gw.example',
    search: new CatalogSearch(async () => [{ videoId: 'M7lc1UVf-VE', title: 't', channelTitle: 'c', publishedAt: 0 }], budget),
    fetchVideoDetails: async () => [],
    agentAvailable: () => true,
    ...over,
  };
}
const u = (p: string) => new URL(`http://localhost${p}`);

describe('HTTP routes', () => {
  it('mints a ticket', async () => {
    __resetTickets();
    const r = await handle('POST', u('/api/mcp-ticket'), deps(), { body: { tabId: 'tab-1' } });
    expect(r?.status).toBe(200);
    expect(String((r?.body as { url: string }).url)).toContain('wss://gw.example');
  });

  it('gives a request with no session an HttpOnly, SameSite=Strict session cookie, and binds the ticket to it', async () => {
    __resetTickets();
    const r = await handle('POST', u('/api/mcp-ticket'), deps(), { body: { tabId: 'tab-1' } });
    const cookie = r?.headers?.['set-cookie'] ?? '';
    expect(cookie).toMatch(/^vvc_session=[0-9a-f-]{36}; HttpOnly; SameSite=Strict; Path=\/api$/);
    const token = new URL((r?.body as { url: string }).url).searchParams.get('ticket') ?? '';
    const sessionId = cookie.split(';')[0]?.split('=')[1];
    expect(redeemTicket(token)).toEqual({ ok: true, sessionId, tabId: 'tab-1' });
  });

  it('keeps an existing session: no new cookie, and the ticket carries that session', async () => {
    __resetTickets();
    const sessionId = '0b0e8a0e-1111-4222-8333-444455556666';
    const r = await handle('POST', u('/api/mcp-ticket'), deps(), { cookie: `other=1; vvc_session=${sessionId}`, body: { tabId: 'tab-1' } });
    expect(r?.headers?.['set-cookie']).toBeUndefined();
    const token = new URL((r?.body as { url: string }).url).searchParams.get('ticket') ?? '';
    expect(redeemTicket(token)).toEqual({ ok: true, sessionId, tabId: 'tab-1' });
  });

  it('a ticket names the tab it is for, and a request without a usable tab id is refused', async () => {
    __resetTickets();
    for (const body of [undefined, {}, { tabId: '' }, { tabId: 'x'.repeat(200) }, { tabId: 'has space' }]) {
      const r = await handle('POST', u('/api/mcp-ticket'), deps(), body === undefined ? {} : { body });
      expect(r?.status).toBe(400);
      expect((r?.body as { reason: string }).reason).toBe('missing_tab_id');
    }
  });

  it('never adopts a session value it did not issue the shape of', async () => {
    __resetTickets();
    const r = await handle('POST', u('/api/mcp-ticket'), deps(), { cookie: 'vvc_session=../../admin', body: { tabId: 'tab-1' } });
    expect(r?.headers?.['set-cookie']).toMatch(/^vvc_session=[0-9a-f-]{36};/);
  });

  it('reports the assistant unavailable rather than minting an unusable ticket', async () => {
    const r = await handle('POST', u('/api/mcp-ticket'), deps({ agentAvailable: () => false }), { body: { tabId: 'tab-1' } });
    expect(r?.status).toBe(503);
    expect((r?.body as { reason: string }).reason).toBe('agent_unavailable');
  });

  it('searches and reports the criteria applied and the quota', async () => {
    const r = await handle('GET', u('/api/catalog/search?q=state+machines'), deps());
    expect(r?.status).toBe(200);
    const body = r?.body as { criteriaApplied: unknown; quota: unknown; results: unknown[] };
    expect(body.criteriaApplied).toBeDefined();
    expect(body.quota).toBeDefined();
    expect(body.results).toHaveLength(1);
  });

  it('refuses a search with no query rather than searching for nothing', async () => {
    const r = await handle('GET', u('/api/catalog/search?q='), deps());
    expect(r?.status).toBe(400);
  });

  it('returns 429 with a reset time when the daily allowance is spent', async () => {
    const spent = new SearchBudget();
    spent.restore(90);
    const d = deps({ search: new CatalogSearch(async () => [], spent) });
    const r = await handle('GET', u('/api/catalog/search?q=x'), d);
    expect(r?.status).toBe(429);
    expect((r?.body as { reason: string }).reason).toBe('quota_exhausted');
  });

  it('requires ids for the videos route', async () => {
    expect((await handle('GET', u('/api/catalog/videos'), deps()))?.status).toBe(400);
    expect((await handle('GET', u('/api/catalog/videos?ids=abc'), deps()))?.status).toBe(200);
  });

  it('leaves an unknown path to the 404 handler', async () => {
    expect(await handle('GET', u('/api/nope'), deps())).toBeUndefined();
  });

  it('parses durations, and returns undefined rather than zero for a shape it does not know', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
    expect(parseIso8601Duration('PT45S')).toBe(45);
    expect(parseIso8601Duration('banana')).toBeUndefined();
  });
});
