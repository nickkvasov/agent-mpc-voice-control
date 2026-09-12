/** Gate B for US2: search, narrow, queue — driven by hand, reading the screen. */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// The backend has no YouTube key here, so it answers 500. Serve a fixture so
// the UI path is exercised; the live catalog call is unverified and says so.
await page.route('**/api/catalog/search*', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      criteriaApplied: { query: 'state machines' },
      fromCache: false,
      quota: { searchCallsRemaining: 88, resetsAt: Date.now() + 3600_000 },
      results: [
        { videoId: 'aaaaaaaaaaa', title: 'Short intro to state machines', channelTitle: 'c', durationSeconds: 300, publishedAt: 0 },
        { videoId: 'bbbbbbbbbbb', title: 'Long deep dive on state machines', channelTitle: 'c', durationSeconds: 4200, publishedAt: 0 },
      ],
    }),
  }),
);

await page.goto('http://localhost:5273/');
await page.waitForSelector('[data-testid="search-input"]');

const read = async () => ({
  op: await page.locator('[data-testid="results-operation"]').innerText(),
  criteria: await page.locator('[data-testid="results-criteria"]').innerText(),
  quota: await page.locator('[data-testid="quota"]').innerText(),
  count: await page.locator('[data-testid="result-item"]').count(),
  queue: await page.locator('[data-testid="queue"] h2').innerText(),
});

console.log('before search:', JSON.stringify(await read()));
await page.fill('[data-testid="search-input"]', 'state machines');
await page.click('[data-testid="search-submit"]');
await page.waitForSelector('[data-testid="result-item"]');
console.log('after search :', JSON.stringify(await read()));

let requests = 0;
page.on('request', (r) => { if (r.url().includes('/api/catalog/search')) requests += 1; });
await page.click('[data-testid="narrow-short"]');
await page.waitForTimeout(250);
console.log('after narrow :', JSON.stringify(await read()));
console.log('network calls during narrow:', requests, '(must be 0)');

await page.locator('[data-testid="result-item"] >> text=Queue').first().click();
await page.waitForTimeout(150);
console.log('after queue  :', JSON.stringify(await read()));

// Narrow again with the same criteria — must say so rather than pretend.
await page.click('[data-testid="narrow-short"]');
await page.waitForTimeout(150);
console.log('narrow twice :', (await read()).op);

console.log('page errors  :', errors.length === 0 ? '(none)' : errors);
await page.screenshot({ path: '/tmp/gateb/us2.png' });
await browser.close();
