import { expect, test, type Page } from '@playwright/test';
import { WebSocket } from 'ws';

/**
 * T139 — quickstart Scenario 7 against the REAL backend, key and page.
 *
 * Spends real assistant turns (about four) and one real search. Assertions are
 * about what the application guarantees, not the model's wording: which tools
 * ran, what was recorded, what state the page is in.
 */
const LIVE = { timeout: 90_000 };

const turn = (page: Page, text: string) =>
  page.locator('[data-testid="assistant-turn"]', { has: page.locator('strong', { hasText: `“${text}”` }) });

async function ask(page: Page, text: string): Promise<void> {
  await page.fill('[data-testid="command-input"]', text);
  await page.click('[data-testid="command-submit"]');
  await expect(turn(page, text)).toBeVisible({ timeout: 1000 });
}

const finished = (page: Page, text: string) =>
  expect(turn(page, text)).toHaveAttribute('data-state', /^(done|refused|cancelled)$/, LIVE);

test.describe.configure({ mode: 'serial' });

test('row 1: available once listed — a command sent the moment the page says connected is not refused', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
  // No settling time on purpose: the gap between the page's handshake and the
  // backend's listing is exactly what this row is about.
  await ask(page, 'what is the player doing right now?');
  await finished(page, 'what is the player doing right now?');
  await expect(turn(page, 'what is the player doing right now?')).toHaveAttribute('data-state', 'done');
  await expect(turn(page, 'what is the player doing right now?').locator('[data-testid="turn-refusal"]')).toHaveCount(0);
});

test('rows 2 and 3: find and narrow with one search and one entry per call; then, with results closed, no stale action', async ({ page }) => {
  const searches: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/catalog/search')) searches.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });

  const find = 'find talks about finite state machines, only the short ones';
  await ask(page, find);
  await finished(page, find);
  const calls = turn(page, find).locator('[data-testid="turn-tool-call"]');
  const callTexts = await calls.allInnerTexts();
  expect(callTexts.some((c) => c.startsWith('catalog.search ✓'))).toBe(true);
  expect(callTexts.some((c) => c.startsWith('catalog.narrow ✓'))).toBe(true);
  // Narrowing spends nothing: exactly one search reached the backend.
  expect(searches).toHaveLength(1);
  const commandId = await turn(page, find).getAttribute('data-command-id');
  await expect(page.locator(`[data-testid="activity-entry"][data-command-id="${String(commandId)}"]`)).toHaveCount(callTexts.length);

  await page.click('[data-testid="toggle-results"]');
  await expect(page.locator('[data-testid="results"]')).toHaveCount(0);
  const play = 'play the third one';
  await ask(page, play);
  await finished(page, play);
  const playCalls = await turn(page, play).locator('[data-testid="turn-tool-call"]').allInnerTexts();
  expect(playCalls.filter((c) => /^(playback\.playVideo|catalog\.resolveReference) ✓/.test(c))).toEqual([]);
  await expect(page.locator('[data-testid="now-playing"]')).toHaveCount(0);
  // FR-035: it names what to open. The wording is the model's; the view's name is the application's.
  const reply = (await turn(page, play).locator('[data-testid="turn-message"]').allInnerTexts()).join(' ');
  console.log(`[live] closed-view reply: ${reply.replace(/\s+/g, ' ').slice(0, 400)}`);
  expect(reply).toMatch(/search results/i);
});

test('row 4: a long request cancelled shows cancelled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
  const long = 'check the player state, then the queue, then my collections, then the activity record, and summarise each in detail';
  await ask(page, long);
  await expect(turn(page, long)).toHaveAttribute('data-state', /^(acknowledged|running|late)$/);
  await turn(page, long).locator('[data-testid="turn-cancel"]').click();
  await expect(turn(page, long)).toHaveAttribute('data-state', 'cancelled', { timeout: 5000 });
  await expect(turn(page, long).locator('[data-testid="turn-cancel"]')).toHaveCount(0);
});

test('row 5: the page\'s own ticket, once used, is refused at the upgrade with 401 and no socket', async ({ page }) => {
  let ticketUrl: string | null = null;
  page.on('response', async (r) => {
    if (r.url().endsWith('/api/mcp-ticket') && r.status() === 200) ticketUrl = ((await r.json()) as { url: string }).url;
  });
  await page.goto('/');
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
  expect(ticketUrl).not.toBeNull();

  const outcome = await new Promise<{ status: number } | 'opened'>((resolve) => {
    const socket = new WebSocket(ticketUrl as unknown as string, { headers: { origin: 'http://localhost:5273' } });
    socket.once('unexpected-response', (_req, res) => { resolve({ status: res.statusCode ?? 0 }); socket.terminate(); });
    socket.once('open', () => { resolve('opened'); socket.close(); });
    socket.once('error', () => {});
  });
  expect(outcome).toEqual({ status: 401 });
  // And the page's own connection is unaffected by the replay.
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected');
});
