import { expect, fake, loadVideo, playerReady, test } from './fixtures/player.ts';

/**
 * T111 — the real player's contract, against the fake IFrame API (R10).
 *
 * Every row reports what the PLAYER confirmed, never what was asked. The
 * stand-in this replaces answered synchronously, so none of these could fail.
 */
const outcome = (page: import('@playwright/test').Page) => page.locator('[data-testid="outcome"]');
const state = (page: import('@playwright/test').Page) => page.locator('[data-testid="state"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Search and press Play where the video is NOT expected to start. */
async function playResultExpectingNoPlayback(page: import('@playwright/test').Page) {
  await playerReady(page);
  await page.route('**/api/catalog/search**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, results: [{ videoId: 'M7lc1UVf-VE', title: 'Will not play', channelTitle: 'c', publishedAt: 0 }], criteriaApplied: {}, fromCache: false, quota: { searchCallsRemaining: 1, resetsAt: 0 } }) }));
  await page.fill('[data-testid="search-input"]', 'x');
  await page.click('[data-testid="search-submit"]');
  await page.locator('[data-testid="result-item"] >> text=Play').first().click();
}

test('there is no player content until a video is chosen, and Play says so', async ({ page }) => {
  await playerReady(page);
  await page.click('[data-testid="btn-play"]');
  await expect(outcome(page)).toContainText('no video loaded');
  await expect(state(page)).not.toContainText('playing');
});

test('Play on a result loads that video into the embedded player and reports it playing', async ({ page }) => {
  await loadVideo(page);
  await expect(page.locator('[data-testid="fake-youtube-iframe"]')).toBeVisible();
  await expect(state(page)).toContainText('playing');
  await expect(page.locator('[data-testid="position"]')).toContainText('600s');
  await expect(outcome(page)).toContainText('Playing');
});

test('pause, seek and speed report what the player confirmed', async ({ page }) => {
  await loadVideo(page);
  await expect(state(page)).toContainText('playing');
  for (const [command, expected] of [['pause', /paused/], ['skip forward two minutes', /120s/], ['speed 1.5', /1\.5x/]] as const) {
    await page.fill('[data-testid="command-input"]', command);
    await page.click('[data-testid="command-submit"]');
    await expect(page.locator('[data-testid="controls"]')).toContainText(expected);
  }
});

test('a state change that never arrives is a refusal naming the actual state, never a success', async ({ page }) => {
  await loadVideo(page);
  await expect(state(page)).toContainText('playing');
  await fake.set(page, { dropNextStateChange: true });
  await page.fill('[data-testid="command-input"]', 'pause');
  await page.click('[data-testid="command-submit"]');
  await expect(outcome(page)).toContainText('still playing');
  await expect(state(page)).toContainText('playing');
});

test('autoplay blocked by the browser is stated, and playback is not reported', async ({ page }) => {
  await fake.set(page, { blockAutoplay: true });
  await playResultExpectingNoPlayback(page);
  await expect(outcome(page)).toContainText('blocked');
  await expect(state(page)).not.toContainText('playing');
});

test('a video that cannot be embedded gives that specific reason (FR-036)', async ({ page }) => {
  await fake.set(page, { errorOnLoad: 101 });
  await playResultExpectingNoPlayback(page);
  await expect(page.locator('[data-testid="player-status"]')).toContainText('does not allow it to be embedded');
  // And on the result itself, where the person would try it again.
  await expect(page.locator('[data-testid="result-unavailable"]')).toContainText('does not allow embedding');
});

test('error 153 is reported as this page\'s origin, not as the video being unavailable', async ({ page }) => {
  await fake.set(page, { errorOnLoad: 153 });
  await playResultExpectingNoPlayback(page);
  const status = page.locator('[data-testid="player-status"]');
  await expect(status).toContainText('origin');
  await expect(status).not.toContainText('does not allow');
  // An origin fault is not a fact about the video, so the result is not marked.
  await expect(page.locator('[data-testid="result-unavailable"]')).toHaveCount(0);
});

test('the position keeps moving while a video plays, without any command', async ({ page }) => {
  // Gate B, real embed: three seconds into playback the controls still read 0s,
  // because they re-rendered only on player events and playback emits none.
  await loadVideo(page);
  await expect(page.locator('[data-testid="position"]')).toContainText(/^[2-9]s \//, { timeout: 4000 });
});

test('a video shorter than a minute shows its seconds, not "0 min"', async ({ page }) => {
  await playerReady(page);
  await page.route('**/api/catalog/search**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, results: [{ videoId: 'M7lc1UVf-VE', title: 'A short', channelTitle: 'c', publishedAt: 0, durationSeconds: 8 }], criteriaApplied: {}, fromCache: false, quota: { searchCallsRemaining: 1, resetsAt: 0 } }) }));
  await page.fill('[data-testid="search-input"]', 'short');
  await page.click('[data-testid="search-submit"]');
  const item = page.locator('[data-testid="result-item"]').first();
  await expect(item).toContainText('(8 s)');
  await expect(item).not.toContainText('0 min');
});

