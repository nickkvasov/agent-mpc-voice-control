/** Gate B for US1: type commands the way a person does and read the screen. */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5273/');
await page.waitForSelector('[data-testid="command-input"]');

const say = async (text) => {
  await page.fill('[data-testid="command-input"]', text);
  await page.click('[data-testid="command-submit"]');
  await page.waitForTimeout(150);
  return {
    understood: await page.locator('[data-testid="understood"]').innerText(),
    outcome: await page.locator('[data-testid="outcome"]').innerText(),
    state: await page.locator('[data-testid="state"]').innerText(),
    position: await page.locator('[data-testid="position"]').innerText(),
    rate: await page.locator('[data-testid="rate"]').innerText(),
  };
};

for (const cmd of ['play', 'skip forward two minutes', 'speed 1.5', 'pause', 'go back a bit', 'turn off subtitles']) {
  const r = await say(cmd);
  console.log(`"${cmd}"`);
  console.log(`   ${r.understood}`);
  console.log(`   ${r.outcome}`);
  console.log(`   state=${r.state} position=${r.position} rate=${r.rate}`);
}
console.log('voice:', await page.locator('[data-testid="voice-detail"]').innerText());
console.log('talk button disabled:', await page.locator('[data-testid="talk-button"]').isDisabled());
console.log('capture indicator present when idle:', await page.locator('[data-testid="capture-indicator"]').count());
console.log('page errors:', errors.length === 0 ? '(none)' : errors);
await page.screenshot({ path: '/tmp/gateb/us1.png' });
await browser.close();
