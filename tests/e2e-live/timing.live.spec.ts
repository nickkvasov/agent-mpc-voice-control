import { expect, test, type Page } from '@playwright/test';

/**
 * T140 — SC-001 and SC-012 measured live, from the end of input (the click that
 * submits typed text; end-of-speech is the voice equivalent and starts the same
 * clock in the page).
 *
 * SC-001: a recognised playback command applies within one second; an
 * assistant-interpreted one is ACKNOWLEDGED within one second (no result budget).
 * SC-012: discovery, queueing and curation are acknowledged within one second
 * and have a result within ten. Measurements are printed for research.md (R9).
 */
test.describe.configure({ mode: 'serial' });

const VIDEO = { videoId: 'M7lc1UVf-VE', title: 'YouTube Developers Live: Embedded Web Player Customization', channelTitle: 'Google Developers', publishedAt: 0 };

const turn = (page: Page, text: string) =>
  page.locator('[data-testid="assistant-turn"]', { has: page.locator('strong', { hasText: `“${text}”` }) });

async function submit(page: Page, text: string): Promise<number> {
  await page.fill('[data-testid="command-input"]', text);
  const t0 = Date.now();
  await page.click('[data-testid="command-submit"]');
  return t0;
}

/** Acknowledgement and result times for an assistant turn, in ms from end of input. */
async function timeTurn(page: Page, text: string): Promise<{ ack: number; result: number; state: string | null }> {
  const t0 = await submit(page, text);
  await expect(turn(page, text)).toBeVisible({ timeout: 1000 });
  const ack = Date.now() - t0;
  await expect(turn(page, text)).toHaveAttribute('data-state', /^(done|refused|cancelled)$/, { timeout: 60_000 });
  return { ack, result: Date.now() - t0, state: await turn(page, text).getAttribute('data-state') };
}

const measured: string[] = [];
test.afterAll(() => {
  console.log(`[timing]\n${measured.join('\n')}`);
});

test('SC-001: a recognised command applies within one second; an assistant playback command is acknowledged within one', async ({ page }) => {
  await page.route('**/api/catalog/search**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, results: [VIDEO], criteriaApplied: { query: 'embedded player' }, fromCache: false, quota: { searchCallsRemaining: null, resetsAt: null } }),
  }));
  await page.goto('/');
  await expect(page.locator('[data-testid="player"]')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
  await page.fill('[data-testid="search-input"]', 'embedded player');
  await page.click('[data-testid="search-submit"]');
  await page.locator('[data-testid="result-item"] >> text=Play').first().click();
  await expect(page.locator('[data-testid="state"]')).toContainText('playing', { timeout: 20_000 });
  await page.waitForTimeout(3000);

  const t0 = await submit(page, 'pause');
  await expect(page.locator('[data-testid="state"]')).toContainText('paused', { timeout: 1000 });
  const applied = Date.now() - t0;
  measured.push(`SC-001 recognised "pause": applied ${String(applied)} ms`);
  expect(applied).toBeLessThan(1000);

  await page.click('[data-testid="btn-play"]');
  await expect(page.locator('[data-testid="state"]')).toContainText('playing');
  const back = await timeTurn(page, 'go back a bit');
  measured.push(`SC-001 assistant "go back a bit": acknowledged ${String(back.ack)} ms, ${String(back.state)} at ${String(back.result)} ms (no result budget)`);
  expect(back.ack).toBeLessThan(1000);
});

test('SC-012: discovery and queueing through the assistant — acknowledged within one second, result within ten', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });

  const find = await timeTurn(page, 'find talks about regular expressions');
  measured.push(`SC-012 discovery "find talks about regular expressions": acknowledged ${String(find.ack)} ms, ${String(find.state)} at ${String(find.result)} ms`);
  const queue = await timeTurn(page, 'queue the first two of those results');
  measured.push(`SC-012 queueing "queue the first two of those results": acknowledged ${String(queue.ack)} ms, ${String(queue.state)} at ${String(queue.result)} ms`);

  expect(find.ack).toBeLessThan(1000);
  expect(queue.ack).toBeLessThan(1000);
  expect(find.state).toBe('done');
  expect(queue.state).toBe('done');
  expect(find.result).toBeLessThan(10_000);
  expect(queue.result).toBeLessThan(10_000);
});
