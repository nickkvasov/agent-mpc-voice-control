/** Gate B for US4: do the confirmation gates actually stop things? */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5273/');
await page.waitForSelector('[data-testid="collection-name"]');

const create = async (name) => {
  await page.fill('[data-testid="collection-name"]', name);
  await page.click('[data-testid="collection-create"]');
  await page.waitForTimeout(150);
  return page.locator('[data-testid="outcome"]').innerText();
};
const collections = () => page.locator('[data-testid="collection-item"]').count();

console.log('create "Favourites"      ->', await create('Favourites'));
console.log('create "favourites" again ->', await create('favourites'));
console.log('collections now          :', await collections());

// Delete: answer the counted confirmation badly, then correctly.
for (const answer of ['yes', 'maybe', '0']) {
  page.once('dialog', (d) => void d.accept(answer));
  await page.click('[data-testid="collection-delete"]');
  await page.waitForTimeout(200);
  console.log(`delete, answered "${answer}" ->`, await page.locator('[data-testid="outcome"]').innerText());
  console.log('   collections remaining:', await collections());
}
page.once('dialog', (d) => void d.accept('0'));
console.log('--- record ---');
const entries = await page.locator('[data-testid="activity-entry"]').all();
for (const e of entries.slice(0, 5)) console.log('  ' + (await e.locator('[data-testid="activity-description"]').innerText()).trim());
console.log('page errors:', errors.length === 0 ? '(none)' : errors);
await browser.close();
