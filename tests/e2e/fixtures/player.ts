import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every deterministic e2e test runs against the fake IFrame API, and nothing
 * from YouTube is fetched. Without this the page would load the real API from
 * the network and the suite would test the network.
 */
const FAKE_API = readFileSync(resolve(import.meta.dirname, 'fake-iframe-api.js'), 'utf8');

export const test = base.extend<{ assistant: 'absent' | 'scripted'; fakeYouTube: void }>({
  /**
   * Whether this test has an assistant. The e2e backend is always running (for
   * the Phase 13 specs), so a test that is about the assistant being ABSENT must
   * say so: it blocks the ticket, and the page is genuinely unconnected. Before
   * Phase 13 these tests passed only because no backend happened to be running.
   */
  assistant: ['absent', { option: true }],
  fakeYouTube: [
    async ({ page, assistant }, use) => {
      if (assistant === 'absent') {
        await page.route('**/api/mcp-ticket', (route) => route.abort());
        await page.route('**/api/assistant/turns', (route) => route.abort());
      }
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
  set: async (page: Page, knobs: Partial<{ blockAutoplay: boolean; dropNextStateChange: boolean; errorOnLoad: number | null; errorFor: Record<string, number> }>) => {
    await page.waitForFunction(() => (window as unknown as { __fakeYT?: object }).__fakeYT !== undefined);
    await page.evaluate((k) => { Object.assign((window as unknown as { __fakeYT: object }).__fakeYT, k); }, knobs);
  },
};

/** Stubs the catalog with these videos and runs one search, so their Play/Queue buttons exist. */
export async function showResults(page: Page, videos: readonly { videoId: string; title: string }[]): Promise<void> {
  await playerReady(page);
  await page.route('**/api/catalog/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: videos.map((v) => ({ ...v, channelTitle: 'c', publishedAt: 0, durationSeconds: 600 })), criteriaApplied: { query: 'x' }, fromCache: false, quota: { searchCallsRemaining: 50, resetsAt: 0 } }),
    }));
  await page.fill('[data-testid="search-input"]', 'several');
  await page.click('[data-testid="search-submit"]');
  await expect(page.locator('[data-testid="result-item"]')).toHaveCount(videos.length);
}

