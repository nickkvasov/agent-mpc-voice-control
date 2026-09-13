import { expect, test } from './fixtures/player.ts';

// Placeholder proving the live/e2e gate actually drives a browser. Replaced by
// the real scenarios in T030/T050/T087/T088.
test('app shell renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toContainText('Voice Video Control');
});
