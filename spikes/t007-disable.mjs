import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('http://localhost:5273/spikes/t007-captions.html');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => window.spikeResult);
  if (s.stage === 'player-ready' && s.lastState === 1) break;
  await wait(1000);
}
await wait(4000);
const r = await page.evaluate(async () => {
  const p = window.player;
  const snap = () => { try { return p.getOption('captions', 'track'); } catch { return 'threw'; } };
  const out = {};
  p.loadModule('captions');
  await new Promise((x) => setTimeout(x, 1500));
  p.setOption('captions', 'track', { languageCode: 'en' });
  await new Promise((x) => setTimeout(x, 1500));
  out.afterEnable = snap();
  // Two candidate ways to turn them off:
  p.setOption('captions', 'track', {});
  await new Promise((x) => setTimeout(x, 1500));
  out.afterSetEmptyTrack = snap();
  p.unloadModule('captions');
  await new Promise((x) => setTimeout(x, 1500));
  out.afterUnloadModule = snap();
  return out;
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
