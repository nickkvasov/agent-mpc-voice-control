import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { attachGateway, type Gateway } from '../../server/gateway/upgrade.ts';
import { __resetTickets, mintTicket } from '../../server/ticket/route.ts';
import { dialPage, type FakeTool } from '../support/fake-page.ts';

/** T119 — the listing is cached per connection and invalidated by the page's own announcement (R6). */
const tool = (name: string, handler: FakeTool['handler'] = () => ({ ok: true, value: name })): FakeTool =>
  ({ name, description: name, inputSchema: { type: 'object' }, handler });

let http: HttpServer | undefined;
let gateway: Gateway | undefined;

async function start() {
  __resetTickets();
  http = createServer();
  gateway = attachGateway(http);
  await new Promise<void>((r) => http?.listen(0, '127.0.0.1', () => r()));
  return `ws://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
}

afterEach(async () => {
  await gateway?.close();
  await new Promise<void>((r) => (http === undefined ? r() : http.close(() => r())));
});

describe('tool listing on a live connection (T119)', () => {
  it('is fetched once and served from cache until the page says it changed', async () => {
    const origin = await start();
    const dialed = await dialPage(mintTicket(origin, 's1', 'tab-1').url, [tool('queue.get')]);
    if (!('page' in dialed)) throw new Error('refused');
    const connection = await gateway?.waitFor('s1', 'tab-1', 2000);
    if (connection === undefined) throw new Error('no connection');
    await connection.listTools();
    await connection.listTools();
    expect(connection.listRequests()).toBe(1);

    await dialed.page.setTools([tool('queue.get'), tool('curation.createCollection')]);
    await new Promise((r) => setTimeout(r, 50));
    expect((await connection.listTools()).map((t) => t.name)).toEqual(['queue.get', 'curation.createCollection']);
    expect(connection.listRequests()).toBe(2);
    dialed.page.close();
  });

  it('two tabs of one browser session stay connected side by side (Phase 11 Gate B)', async () => {
    // Gate B: with "one connection per session", two tabs replaced each other,
    // the library reconnected the loser, and the pair fought over one slot.
    const origin = await start();
    const tabA = await dialPage(mintTicket(origin, 's2', 'tab-a').url, [tool('a.one')]);
    const tabB = await dialPage(mintTicket(origin, 's2', 'tab-b').url, [tool('b.two')]);
    if (!('page' in tabA) || !('page' in tabB)) throw new Error('refused');
    await gateway?.waitFor('s2', 'tab-a', 2000);
    await gateway?.waitFor('s2', 'tab-b', 2000);
    await new Promise((r) => setTimeout(r, 50));
    expect(tabA.page.socket.readyState).toBe(1);
    expect((await gateway?.connectionFor('s2', 'tab-a')?.listTools())?.map((t) => t.name)).toEqual(['a.one']);
    expect((await gateway?.connectionFor('s2', 'tab-b')?.listTools())?.map((t) => t.name)).toEqual(['b.two']);
    tabA.page.close();
    tabB.page.close();
  });

  it('the same tab reconnecting replaces its own earlier connection, which is closed', async () => {
    const origin = await start();
    const first = await dialPage(mintTicket(origin, 's2', 'tab-a').url, [tool('a.one')]);
    if (!('page' in first)) throw new Error('refused');
    const firstClosed = new Promise<void>((r) => first.page.socket.once('close', () => r()));
    await gateway?.waitFor('s2', 'tab-a', 2000);
    const second = await dialPage(mintTicket(origin, 's2', 'tab-a').url, [tool('a.again')]);
    if (!('page' in second)) throw new Error('refused');
    await firstClosed;
    await new Promise((r) => setTimeout(r, 50));
    expect((await gateway?.connectionFor('s2', 'tab-a')?.listTools())?.map((t) => t.name)).toEqual(['a.again']);
    second.page.close();
  });

  it('a call to a tool the page no longer has comes back as a refusal, not a thrown transport error', async () => {
    const origin = await start();
    const dialed = await dialPage(mintTicket(origin, 's3', 'tab-1').url, [tool('curation.createCollection')]);
    if (!('page' in dialed)) throw new Error('refused');
    const connection = await gateway?.waitFor('s3', 'tab-1', 2000);
    await dialed.page.setTools([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(await connection?.listTools()).toEqual([]);
    const outcome = await connection?.callTool('curation.createCollection', { name: 'x', commandId: 'cmd-1' });
    expect(outcome).toMatchObject({ ok: false });
    dialed.page.close();
  });
});
