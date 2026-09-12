import { expect, test } from '@playwright/test';

/**
 * T050 — SC-012: discovery, queueing and curation produce a visible result
 * within three seconds of the person finishing speaking.
 *
 * Same caveat as T030: the recognition segment is not included, because
 * on-device recognition cannot be driven headless. This is a budget floor.
 *
 * The catalog call is served from a fixture. A live search depends on a YouTube
 * key this environment does not have, so the upstream half is unverified — what
 * is measured here is everything from the request leaving to the result being
 * on screen.
 */
const APPLY_BUDGET_MS = 3000;

test.describe('SC-012 budget', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/catalog/search*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          criteriaApplied: { query: 'state machines' },
          fromCache: false,
          quota: { searchCallsRemaining: 88, resetsAt: Date.now() + 3600_000 },
          results: Array.from({ length: 25 }, (_, i) => ({
            videoId: `vid${String(i).padStart(8, '0')}`,
            title: `Talk number ${String(i)} about state machines`,
            channelTitle: 'c',
            durationSeconds: i % 2 === 0 ? 300 : 4200,
            publishedAt: 0,
          })),
        }),
      }),
    );
    await page.goto('/');
    await page.waitForSelector('[data-testid="search-input"]');
  });

  test('a search is on screen inside the budget', async ({ page }) => {
    await page.fill('[data-testid="search-input"]', 'state machines');
    const started = Date.now();
    await page.click('[data-testid="search-submit"]');
    await page.waitForSelector('[data-testid="result-item"]');
    await expect(page.locator('[data-testid="results-operation"]')).toContainText('fresh search');
    const ms = Date.now() - started;
    expect(ms, `search took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
  });

  test('narrowing is visible almost immediately, since it spends nothing', async ({ page }) => {
    await page.fill('[data-testid="search-input"]', 'state machines');
    await page.click('[data-testid="search-submit"]');
    await page.waitForSelector('[data-testid="result-item"]');
    const started = Date.now();
    await page.click('[data-testid="narrow-short"]');
    await expect(page.locator('[data-testid="results-operation"]')).toContainText('Narrowed');
    const ms = Date.now() - started;
    expect(ms, `narrow took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
  });

  test('queueing is visible inside the budget', async ({ page }) => {
    await page.fill('[data-testid="search-input"]', 'state machines');
    await page.click('[data-testid="search-submit"]');
    await page.waitForSelector('[data-testid="result-item"]');
    const started = Date.now();
    await page.locator('[data-testid="result-item"] >> text=Queue').first().click();
    await expect(page.locator('[data-testid="queue"] h2')).toContainText('Queue (1)');
    const ms = Date.now() - started;
    expect(ms, `queue took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
  });
});
