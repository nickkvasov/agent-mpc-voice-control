/** Gate B for US3: does the record show what happened, and does undo work? */
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
      results: [
        { videoId: 'aaaaaaaaaaa', title: 'Short talk', channelTitle: 'c', durationSeconds: 300, publishedAt: 0 },
        { videoId: 'bbbbbbbbbbb', title: 'Long talk', channelTitle: 'c', durationSeconds: 4200, publishedAt: 0 },
      ],
    }),
  }),
);
await page.goto('http://localhost:5273/');
await page.waitForSelector('[data-testid="command-input"]');

const record = async () => {
  const entries = await page.locator('[data-testid="activity-entry"]').all();
  const out = [];
  for (const e of entries) {
    out.push({
      what: (await e.locator('[data-testid="activity-description"]').innerText()).trim(),
      undo: (await e.locator('[data-testid="activity-undo"]').innerText()).trim(),
    });
  }
  return out;
};

// Do things: a refusal, a success, a search, a queue.
await page.fill('[data-testid="command-input"]', 'pause');
await page.click('[data-testid="command-submit"]');
await page.waitForTimeout(200);
await page.fill('[data-testid="command-input"]', 'play');
await page.click('[data-testid="command-submit"]');
await page.waitForTimeout(200);
await page.fill('[data-testid="search-input"]', 'talks');
await page.click('[data-testid="search-submit"]');
await page.waitForSelector('[data-testid="result-item"]');
await page.locator('[data-testid="result-item"] >> text=Queue').first().click();
await page.waitForTimeout(250);

console.log('--- the record, most recent first ---');
for (const r of await record()) console.log(`  ${r.what}\n      ${r.undo}`);
console.log('queue:', await page.locator('[data-testid="queue"] h2').innerText());
console.log('"what did you just do?" ->');
console.log((await page.locator('[data-testid="what-did-you-do"]').innerText()).split('\n').map((l) => '   ' + l).join('\n'));

const undoButtons = await page.locator('[data-testid="undo-button"]').count();
console.log('undo buttons offered:', undoButtons);
if (undoButtons > 0) {
  await page.locator('[data-testid="undo-button"]').first().click();
  await page.waitForTimeout(250);
  console.log('after undo, queue:', await page.locator('[data-testid="queue"] h2').innerText());
  console.log('after undo, outcome:', await page.locator('[data-testid="outcome"]').innerText());
  console.log('--- record after undo ---');
  for (const r of await record()) console.log(`  ${r.what}\n      ${r.undo}`);
}
// Gate C found Undo offered on a removal it could never restore. Drive it.
console.log('--- queue, remove, then undo the REMOVAL ---');
await page.locator('[data-testid="result-item"] >> text=Queue').first().click();
await page.waitForTimeout(200);
console.log('queued      :', await page.locator('[data-testid="queue"] h2').innerText());
await page.locator('[data-testid="queue-item"] >> text=Remove').first().click();
await page.waitForTimeout(200);
console.log('removed     :', await page.locator('[data-testid="queue"] h2').innerText());
const btns = await page.locator('[data-testid="undo-button"]').all();
if (btns.length > 0) {
  await btns[0].click();
  await page.waitForTimeout(300);
  console.log('after undo  :', await page.locator('[data-testid="queue"] h2').innerText());
  console.log('outcome     :', await page.locator('[data-testid="outcome"]').innerText());
}
console.log('record size :', await page.locator('[data-testid="activity-entry"]').count());
console.log('page errors:', errors.length === 0 ? '(none)' : errors);
await browser.close();
