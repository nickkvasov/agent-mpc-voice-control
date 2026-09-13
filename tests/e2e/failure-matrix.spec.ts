import { expect, test, type Page } from '@playwright/test';

/**
 * T087 — quickstart Scenario 5.
 *
 * Every row must produce a STATED REASON (SC-009). This is where mocked tests
 * are least trustworthy, because each case is about what the system does when
 * something is wrong, and a mock is by definition something going right.
 */
const outcome = (page: Page) => page.locator('[data-testid="outcome"]');

async function send(page: Page, command: string) {
  await page.fill('[data-testid="command-input"]', command);
  await page.click('[data-testid="command-submit"]');
  await page.waitForTimeout(200);
}

test.describe('failure matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="command-input"]');
  });

  test('the assistant being unavailable is SHOWN, and the app still works by hand', async ({ page }) => {
    const status = page.locator('[data-testid="connection-status"]');
    await expect(status).toHaveAttribute('data-state', 'unavailable');
    await expect(page.locator('[data-testid="connection-reason"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="hand-path"]')).toContainText('still works by hand');
    // And the hand path genuinely works.
    await page.click('[data-testid="btn-play"]');
    await expect(page.locator('[data-testid="state"]')).toContainText('playing');
  });

  test('a command the matcher declines is refused with a reason, not ignored', async ({ page }) => {
    await send(page, 'go back a bit');
    await expect(outcome(page)).toContainText('nothing was done');
    await expect(outcome(page)).toContainText('by hand');
  });

  test('an unbuilt capability says so, and does NOT tell you to open a view that is already open', async ({ page }) => {
    // This test previously asserted "the player", which was the defect: the
    // player is right there on screen, so recommending that someone open it
    // cannot resolve anything (Gate C).
    await send(page, 'next');
    await expect(outcome(page)).toContainText('not available in this build yet');
    await expect(outcome(page)).toContainText('Nothing was changed');
    await expect(outcome(page)).not.toContainText('Open the player');
  });

  test('pausing when nothing plays says so rather than failing silently', async ({ page }) => {
    await send(page, 'pause');
    await expect(outcome(page)).toContainText('Nothing is playing');
  });

  test('captions off states what could not be confirmed', async ({ page }) => {
    await send(page, 'turn off subtitles');
    await expect(outcome(page)).toContainText('could not confirm');
  });

  test('a quota refusal is stated and leaves loaded results usable', async ({ page }) => {
    await page.route('**/api/catalog/search*', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, reason: 'quota_exhausted', detail: 'the shared allowance is spent for now' }),
      }),
    );
    await page.fill('[data-testid="search-input"]', 'anything');
    await page.click('[data-testid="search-submit"]');
    await expect(outcome(page)).toContainText('allowance is spent');
    // Playback still works while the catalog is refusing.
    await page.click('[data-testid="btn-play"]');
    await expect(page.locator('[data-testid="state"]')).toContainText('playing');
  });

  test('an unreachable catalog is reported, not shown as an empty result set', async ({ page }) => {
    await page.route('**/api/catalog/search*', (route) => route.abort());
    await page.fill('[data-testid="search-input"]', 'anything');
    await page.click('[data-testid="search-submit"]');
    await expect(outcome(page)).toContainText('could not be reached');
    await expect(page.locator('[data-testid="results-empty"]')).toContainText('That is the filter, not a failure');
  });

  test('every refusal in this run left a stated reason in the record', async ({ page }) => {
    await send(page, 'pause');
    await send(page, 'turn off subtitles');
    const entries = page.locator('[data-testid="activity-entry"]');
    await expect(entries).not.toHaveCount(0);
    const details = page.locator('[data-testid="activity-detail"]');
    const n = await details.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) {
      await expect(details.nth(i)).not.toBeEmpty();
    }
  });
});
