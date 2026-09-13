import { expect, test, type Page } from '@playwright/test';

/**
 * T112 — the REAL YouTube embed (research R10).
 *
 * The deterministic suite runs against a fake IFrame API. The fake is trusted
 * only for what this also observes: if a behaviour passes there and not here,
 * the fake is wrong, not this. Needs network. The catalog request is stubbed so
 * this spends no search quota — the player under test is entirely real.
 *
 * The video is the one the captions spike (T007) measured: public, embeddable,
 * with an English caption track.
 */
const VIDEO = { videoId: 'M7lc1UVf-VE', title: 'YouTube Developers Live: Embedded Web Player Customization', channelTitle: 'Google Developers', publishedAt: 0 };
const NETWORK = { timeout: 20_000 };

const controls = (page: Page) => page.locator('[data-testid="controls"]');
const state = (page: Page) => page.locator('[data-testid="state"]');

async function send(page: Page, command: string) {
  await page.fill('[data-testid="command-input"]', command);
  await page.click('[data-testid="command-submit"]');
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/catalog/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: [VIDEO], criteriaApplied: { query: 'embedded player' }, fromCache: false, quota: { searchCallsRemaining: null, resetsAt: null } }),
    }));
  await page.goto('/');
  await expect(page.locator('[data-testid="player"]')).toHaveAttribute('data-ready', 'true', NETWORK);
});

test('the real embed plays, pauses, seeks, changes speed and turns captions on — each read back', async ({ page }) => {
  await page.fill('[data-testid="search-input"]', 'embedded player');
  await page.click('[data-testid="search-submit"]');
  await page.locator('[data-testid="result-item"] >> text=Play').first().click();
  // A real embed: an iframe from youtube.com, not the fake.
  await expect(page.locator('iframe[src*="youtube.com/embed"]')).toBeVisible(NETWORK);
  await expect(state(page)).toContainText('playing', NETWORK);

  await send(page, 'pause');
  await expect(state(page)).toContainText('paused', NETWORK);

  // The local matcher's seek grammar is relative (playback-matcher.ts).
  await send(page, 'skip forward one minute');
  await expect(page.locator('[data-testid="position"]')).toContainText(/^(5[89]|6[0-2])s/, NETWORK);

  await send(page, 'speed 1.5');
  await expect(controls(page)).toContainText('1.5x', NETWORK);

  await send(page, 'turn on subtitles');
  await expect(page.locator('[data-testid="captions"]')).toContainText('en', NETWORK);
});
