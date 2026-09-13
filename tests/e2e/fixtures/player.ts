import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every deterministic e2e test runs against the fake IFrame API, and nothing
 * from YouTube is fetched. Without this the page would load the real API from
 * the network and the suite would test the network.
 */
const FAKE_API = readFileSync(resolve(import.meta.dirname, 'fake-iframe-api.js'), 'utf8');

export const test = base.extend<{ fakeYouTube: void }>({
  fakeYouTube: [
    async ({ page }, use) => {
      // Registration order matters: Playwright gives the MOST RECENTLY registered
      // matching route precedence, so the catch-all abort goes first and the
      // fake API after it. The other way round aborted the fake itself.
      await page.route(/^https:\/\/(www\.)?(youtube\.com|ytimg\.com|googlevideo\.com)\//, (route) => route.abort());
      await page.route('https://www.youtube.com/iframe_api', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: FAKE_API }));
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export const VIDEO = { videoId: 'M7lc1UVf-VE', title: 'YouTube Developers Live: Embedded Web Player Customization', channelTitle: 'Google Developers', publishedAt: 0, durationSeconds: 1234 };

/**
 * Waits for the embedded player to be usable. Before this every playback tool
 * answers "still loading" — true, and not what a test about playback means to test.
 */
export async function playerReady(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="player"]')).toHaveAttribute('data-ready', 'true');
}

/** Loads a video the way a person does: search, then Play on a result. */
export async function loadVideo(page: Page, video = VIDEO): Promise<void> {
  await playerReady(page);
  await page.route('**/api/catalog/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: [video], criteriaApplied: { query: 'x' }, fromCache: false, quota: { searchCallsRemaining: 50, resetsAt: 0 } }),
    }));
  await page.fill('[data-testid="search-input"]', 'embedded player');
  await page.click('[data-testid="search-submit"]');
  await page.locator('[data-testid="result-item"] >> text=Play').first().click();
  await expect(page.locator('[data-testid="state"]')).toContainText('playing');
}

export const fake = {
  /** Waits for the page to have loaded the (fake) API, then steers it. */
  set: async (page: Page, knobs: Partial<{ blockAutoplay: boolean; dropNextStateChange: boolean; errorOnLoad: number | null }>) => {
    await page.waitForFunction(() => (window as unknown as { __fakeYT?: object }).__fakeYT !== undefined);
    await page.evaluate((k) => { Object.assign((window as unknown as { __fakeYT: object }).__fakeYT, k); }, knobs);
  },
};
