import { expect, loadVideo, test } from './fixtures/player.ts';

/**
 * T030 — SC-001: a playback command is visible within one second of the person
 * finishing speaking, recognition and round-trip INCLUDED.
 *
 * What this measures: the segment from the command being issued to the result
 * being on screen — matcher, tool, readback and render.
 *
 * What it does NOT measure: the recognition segment. On-device recognition
 * cannot be driven here — the availability probe kills the renderer in headless
 * Chrome (T008), and nothing can synthesise a real on-device transcript. So this
 * asserts a BUDGET FLOOR, not SC-001 itself: if this segment alone exceeds the
 * budget, SC-001 is already lost. Passing it does not establish SC-001.
 *
 * The recognition segment needs a headed harness with a real microphone, which
 * does not exist yet. Recorded in tasks.md rather than quietly implied.
 */
const BUDGET_MS = 1000;
/** Recognition is expected to consume much of the second; leave it room. */
const APPLY_BUDGET_MS = 400;

async function timeCommand(page: import('@playwright/test').Page, command: string, expectation: RegExp) {
  await page.fill('[data-testid="command-input"]', command);
  const started = Date.now();
  await page.click('[data-testid="command-submit"]');
  await expect(page.locator('[data-testid="outcome"]')).toBeVisible();
  await expect(page.locator('[data-testid="state"], [data-testid="position"], [data-testid="rate"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="controls"]')).toContainText(expectation);
  return Date.now() - started;
}

test.describe('SC-001 budget', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="command-input"]');
    // A video is chosen first, as a person would; the stand-in pretended one was cued.
    await loadVideo(page);
  });

  test('play becomes visible well inside the budget', async ({ page }) => {
    await timeCommand(page, 'pause', /paused/);
    const ms = await timeCommand(page, 'play', /playing/);
    expect(ms, `play took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  test('seek becomes visible well inside the budget', async ({ page }) => {
    const ms = await timeCommand(page, 'skip forward two minutes', /120s/);
    expect(ms, `seek took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
  });

  test('speed change becomes visible well inside the budget', async ({ page }) => {
    const ms = await timeCommand(page, 'speed 1.5', /1\.5x/);
    expect(ms, `speed took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
  });

  test('pause becomes visible well inside the budget', async ({ page }) => {
    const ms = await timeCommand(page, 'pause', /paused/);
    expect(ms, `pause took ${String(ms)}ms`).toBeLessThan(APPLY_BUDGET_MS);
  });
});
