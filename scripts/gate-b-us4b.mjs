/** Gate B: the full curation loop — add, label, tag, remove, undo, reload. */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/api/catalog/search*', (route) =>
  route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, criteriaApplied: { query: 'talks' }, fromCache: false,
      quota: { searchCallsRemaining: 88, resetsAt: Date.now() + 3600_000 },
      results: [{ videoId: 'aaaaaaaaaaa', title: 'Original YouTube title', channelTitle: 'c', durationSeconds: 300, publishedAt: 0 }],
    }),
  }),
);
await page.goto('http://localhost:5273/');
await page.waitForSelector('[data-testid="collection-name"]');

await page.fill('[data-testid="collection-name"]', 'Favourites');
await page.click('[data-testid="collection-create"]');
await page.fill('[data-testid="search-input"]', 'talks');
await page.click('[data-testid="search-submit"]');
await page.waitForSelector('[data-testid="result-item"]');
await page.click('[data-testid="add-to-collection"]');
await page.waitForTimeout(250);
console.log('added to collection :', await page.locator('[data-testid="outcome"]').innerText());
console.log('collection shows    :', (await page.locator('[data-testid="collection-video"]').innerText()).replace(/\s+/g, ' ').slice(0, 110));

page.once('dialog', (d) => void d.accept('Q3 retro'));
await page.click('[data-testid="label-video"]');
await page.waitForTimeout(250);
console.log('after label         :', await page.locator('[data-testid="outcome"]').innerText());
console.log('collection now shows:', (await page.locator('[data-testid="collection-video"]').innerText()).replace(/\s+/g, ' ').slice(0, 130));

// FR-026: removing must name its target and wait.
page.once('dialog', (d) => { console.log('prompt asked        :', d.message()); void d.dismiss(); });
await page.click('[data-testid="remove-from-collection"]');
await page.waitForTimeout(250);
console.log('dismissed removal   :', await page.locator('[data-testid="outcome"]').innerText());
console.log('still in collection :', await page.locator('[data-testid="collection-video"]').count());

// Undo the membership addition.
const undo = await page.locator('[data-testid="undo-button"]').all();
console.log('undo buttons        :', undo.length);
if (undo.length > 0) {
  await undo[0].click();
  await page.waitForTimeout(250);
  console.log('after undo          :', await page.locator('[data-testid="outcome"]').innerText());
}

// FR-039: survives a reload.
await page.reload();
await page.waitForSelector('[data-testid="collections-list"], [data-testid="collections-empty"]');
console.log('after reload        :', await page.locator('[data-testid="curation"] h2').innerText());
console.log('storage warning     :', await page.locator('[data-testid="storage-warning"]').count());
console.log('page errors         :', errors.length === 0 ? '(none)' : errors);
await browser.close();
