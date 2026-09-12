/**
 * Gate B, US2, WITHOUT stubbing the API route.
 *
 * The previous run intercepted /api/catalog/search, which is precisely why it
 * could not show that Vite had no proxy to the backend — the Search button was
 * receiving the SPA's own HTML. A fixture that stands in for the integration
 * under test cannot test it.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5273/');
await page.waitForSelector('[data-testid="search-input"]');

const direct = await page.evaluate(async () => {
  const res = await fetch('/api/catalog/search?q=test');
  const text = await res.text();
  return { status: res.status, looksLikeHtml: text.trimStart().startsWith('<'), head: text.slice(0, 90) };
});
console.log('raw /api reachability:', JSON.stringify(direct));

await page.fill('[data-testid="search-input"]', 'state machines');
await page.click('[data-testid="search-submit"]');
await page.waitForTimeout(1200);
console.log('outcome shown        :', await page.locator('[data-testid="outcome"]').innerText().catch(() => '(none rendered)'));
console.log('page errors          :', errors.length === 0 ? '(none)' : errors);
await browser.close();
