import type { Page } from '@playwright/test';
import { expect, playerReady, test } from './fixtures/player.ts';
import { ask, assistantConnected, turn } from './fixtures/assistant.ts';

/**
 * T136 — US2 through the assistant: find, narrow without spending the search
 * allowance, play by position, and — with the results view closed — be told the
 * view is not open rather than act on a listing that is no longer on screen.
 */
test.use({ assistant: 'scripted' });

/** Five results; three of them are under ten minutes. The third short one is "Short three". */
const VIDEOS = [
  { videoId: 'shortone001', title: 'Short one', durationSeconds: 300 },
  { videoId: 'longone0001', title: 'Long one', durationSeconds: 1200 },
  { videoId: 'shorttwo001', title: 'Short two', durationSeconds: 400 },
  { videoId: 'shortthree1', title: 'Short three', durationSeconds: 500 },
  { videoId: 'longtwo0001', title: 'Long two', durationSeconds: 2000 },
];

async function stubCatalog(page: Page): Promise<{ searches: () => number }> {
  let searches = 0;
  await page.route('**/api/catalog/search**', (route) => {
    searches += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        results: VIDEOS.map((v) => ({ ...v, channelTitle: 'c', publishedAt: 0 })),
        criteriaApplied: { query: 'state machines' },
        fromCache: false,
        quota: { searchCallsRemaining: 49, resetsAt: 0 },
      }),
    });
  });
  return { searches: () => searches };
}

test('find, then "only the short ones" spending no allowance, then "play the third one" (FR-016, SC-012)', async ({ page }) => {
  const catalog = await stubCatalog(page);
  await page.goto('/');
  await assistantConnected(page);
  await playerReady(page);
  const results = page.locator('[data-testid="result-item"]');

  const sent = Date.now();
  await ask(page, 'find talks about state machines');
  await expect(turn(page, 'find talks about state machines')).toBeVisible({ timeout: 1000 });
  expect(Date.now() - sent).toBeLessThan(1000);
  await expect(turn(page, 'find talks about state machines')).toHaveAttribute('data-state', 'done');
  await expect(results).toHaveCount(5);
  expect(catalog.searches()).toBe(1);

  await ask(page, 'only the short ones');
  await expect(turn(page, 'only the short ones')).toHaveAttribute('data-state', 'done');
  await expect(results).toHaveCount(3);
  // Narrowing is applied to what is loaded: no second search, no allowance spent.
  expect(catalog.searches()).toBe(1);
  await expect(page.locator('[data-testid="results"]')).toContainText('49');

  await ask(page, 'play the third one');
  await expect(turn(page, 'play the third one')).toHaveAttribute('data-state', 'done');
  await expect(turn(page, 'play the third one').locator('[data-testid="turn-tool-call"]')).toHaveText([/catalog\.resolveReference ✓/, /playback\.playVideo ✓/]);
  await expect(page.locator('[data-testid="now-playing"]')).toContainText('Short three');
  await expect(page.locator('[data-testid="state"]')).toContainText('playing');
});

test('with the results view closed mid-turn, the assistant is told the view is not open (FR-035)', async ({ page }) => {
  await stubCatalog(page);
  await page.goto('/');
  await assistantConnected(page);
  await playerReady(page);
  await page.fill('[data-testid="search-input"]', 'state machines');
  await page.click('[data-testid="search-submit"]');
  await expect(page.locator('[data-testid="result-item"]')).toHaveCount(5);

  // The model reads the results, takes 1.5 s over the player's state, then
  // resolves "the first one". The view closes during that pause, so the step
  // that calls resolveReference lists tools WITHOUT it: the model is acting on
  // what it saw earlier in the turn, exactly the stale listing FR-035 is about.
  await ask(page, 'play the first one');
  const calls = turn(page, 'play the first one').locator('[data-testid="turn-tool-call"]');
  await expect(calls.first()).toHaveText(/catalog\.getCurrentResults ✓/);
  await page.click('[data-testid="toggle-results"]');
  await expect(page.locator('[data-testid="results"]')).toHaveCount(0);

  await expect(calls.nth(1)).toHaveText(/playback\.getState ✓/, { timeout: 5000 });
  await expect(calls.nth(2)).toContainText('catalog.resolveReference — refused', { timeout: 5000 });
  await expect(calls.nth(2)).toContainText('needs the search results, which is not open');
  await expect(turn(page, 'play the first one').locator('[data-testid="turn-message"]')).toContainText('view_not_open');
  await expect(page.locator('[data-testid="now-playing"]')).toHaveCount(0);
});
