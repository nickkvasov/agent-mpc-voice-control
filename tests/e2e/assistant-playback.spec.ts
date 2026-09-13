import { expect, loadVideo, test } from './fixtures/player.ts';
import { ask, assistantConnected, E2E_TURNS_PER_SESSION, turn } from './fixtures/assistant.ts';

/**
 * T135 — US1 through the assistant: the real page, gateway and turn endpoint,
 * with the scripted model (tests/e2e/fixtures/assistant-script.json).
 */
test.use({ assistant: 'scripted' });

const position = async (page: import('@playwright/test').Page): Promise<number> =>
  Number((await page.locator('[data-testid="position"]').innerText()).split('s')[0]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await assistantConnected(page);
  await loadVideo(page);
  // Somewhere to go back from.
  await page.click('[data-testid="btn-fwd"]');
  await page.click('[data-testid="btn-fwd"]');
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(28);
});

test('"go back a bit" is acknowledged within one second and applied when the assistant acts (SC-001)', async ({ page }) => {
  const before = await position(page);
  const sent = Date.now();
  await ask(page, 'go back a bit');
  await expect(turn(page, 'go back a bit')).toBeVisible({ timeout: 1000 });
  const acknowledgedWithin = Date.now() - sent;
  expect(acknowledgedWithin).toBeLessThan(1000);

  await expect(turn(page, 'go back a bit')).toHaveAttribute('data-state', 'done');
  await expect(turn(page, 'go back a bit').locator('[data-testid="turn-tool-call"]')).toHaveText(/playback\.seek ✓/);
  await expect(turn(page, 'go back a bit').locator('[data-testid="turn-message"]')).toHaveText('Went back ten seconds.');
  await expect.poll(() => position(page)).toBeLessThanOrEqual(before - 8);
});

test('pause pressed before the assistant acts applies, and the older seek is refused as overtaken (FR-038)', async ({ page }) => {
  const before = await position(page);
  // The scripted model takes 1.5 s to decide on its seek.
  await ask(page, 'go back a little, slowly');
  await expect(turn(page, 'go back a little, slowly')).toBeVisible({ timeout: 1000 });
  await page.click('[data-testid="btn-pause"]');
  await expect(page.locator('[data-testid="state"]')).toContainText('paused');

  const call = turn(page, 'go back a little, slowly').locator('[data-testid="turn-tool-call"]');
  await expect(call).toContainText('playback.seek — refused', { timeout: 5000 });
  await expect(call).toContainText('issued later, already changed this');
  // The newer command's effect stands and the older one did not apply over it.
  await expect(page.locator('[data-testid="state"]')).toContainText('paused');
  expect(await position(page)).toBeGreaterThanOrEqual(before - 1);
});

test('a spent allowance shows the assistant unavailable, and on an idle page it comes back at its reset time (FR-046)', async ({ page }) => {
  // Page time is controlled from here; it still flows until moved on.
  await page.clock.install();
  await page.reload();
  await assistantConnected(page);

  for (let i = 1; i <= E2E_TURNS_PER_SESSION; i += 1) {
    await ask(page, `say hello ${String(i)}`);
    await expect(turn(page, `say hello ${String(i)}`)).toHaveAttribute('data-state', 'done');
  }
  await ask(page, 'say hello again');
  await expect(turn(page, 'say hello again')).toHaveAttribute('data-state', 'refused');
  const status = page.locator('[data-testid="connection-status"]');
  await expect(status).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('[data-testid="connection-reason"]')).toContainText('available again at');

  // Nothing else happens on the page: no command, no click. Only time passes.
  await page.clock.fastForward('24:00:01');
  await expect(status).toHaveAttribute('data-state', 'connected');

  // And the next command is sent to the assistant rather than refused on the page.
  const sent = page.waitForRequest((r) => r.url().endsWith('/api/assistant/turns') && r.method() === 'POST');
  await ask(page, 'say hello once more');
  await sent;
});
