/**
 * Gate B driver: opens the running app in a real browser, reports what is on
 * screen and every console message, and saves a screenshot.
 *
 * Exit code 0 means the script finished, NOT that the page is right — the
 * output is for a person to read. That distinction is the whole point of the
 * gate.
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5273/';
const shot = process.argv[3] ?? 'gate-b.png';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const messages = [];
page.on('console', (m) => messages.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));

await page.goto(url);
await page.waitForTimeout(2500);

console.log('url        :', url);
console.log('title      :', await page.title());
console.log('#root text :', JSON.stringify((await page.locator('#root').innerText()).slice(0, 120)));
console.log('console    :', messages.length === 0 ? '(none)' : `${messages.length} message(s)`);
for (const m of messages) console.log('   ', m);
await page.screenshot({ path: shot });
console.log('screenshot :', shot);
await browser.close();
