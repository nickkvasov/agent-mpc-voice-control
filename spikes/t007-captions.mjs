// T007 — R4 spike: can the IFrame Player API control captions at all?
// The public reference documents only setOption('captions','fontSize'|'reload').
// FR-010 depends on the answer, so it is measured, not assumed.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('http://localhost:5273/spikes/t007-captions.html');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the player to be ready and actually playing; the captions module
// does not exist before playback begins.
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => window.spikeResult);
  if (s.stage === 'player-ready' && s.lastState === 1) break;
  if (s.error !== undefined) { console.log('player error code:', s.error); break; }
  await wait(1000);
}
await wait(4000);

const probe = await page.evaluate(() => {
  const p = window.player;
  const out = { state: window.spikeResult, methods: {}, captions: {} };
  for (const m of ['loadModule', 'unloadModule', 'setOption', 'getOption', 'getOptions']) {
    out.methods[m] = typeof p?.[m];
  }
  const tryCall = (label, fn) => { try { out.captions[label] = fn(); } catch (e) { out.captions[label] = 'threw: ' + String(e); } };

  tryCall('getOptions()', () => p.getOptions());
  tryCall('loadModule(captions)', () => { p.loadModule('captions'); return 'called'; });
  tryCall('getOptions(captions)', () => p.getOptions('captions'));
  tryCall('getOption(captions,tracklist)', () => p.getOption('captions', 'tracklist'));
  tryCall('getOption(captions,track)', () => p.getOption('captions', 'track'));
  return out;
});
console.log(JSON.stringify(probe, null, 2));

// Now try to actually turn a track on, and read it back.
await page.evaluate(() => {
  try { window.player.setOption('captions', 'track', { languageCode: 'en' }); } catch (e) { window.spikeSetErr = String(e); }
});
await wait(2500);
const after = await page.evaluate(() => {
  const p = window.player;
  const r = { setErr: window.spikeSetErr ?? null };
  try { r.trackAfterSet = p.getOption('captions', 'track'); } catch (e) { r.trackAfterSet = 'threw: ' + String(e); }
  try { r.tracklistAfterSet = p.getOption('captions', 'tracklist'); } catch (e) { r.tracklistAfterSet = 'threw: ' + String(e); }
  return r;
});
console.log('AFTER setOption:', JSON.stringify(after, null, 2));

await browser.close();
