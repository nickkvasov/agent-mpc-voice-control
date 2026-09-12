// T008 — R1 spike: is on-device speech recognition actually available?
// Probed in a real browser, in stages, so a crash names which stage caused it.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('crash', () => console.log('  !! page crashed'));
await page.goto('http://localhost:5273/');

async function stage(name, fn) {
  try {
    const v = await page.evaluate(fn);
    console.log(`  ${name}:`, JSON.stringify(v));
    return v;
  } catch (e) {
    console.log(`  ${name}: THREW ${e.message.split('\n')[0]}`);
    return null;
  }
}

console.log('browser:', browser.version());
await stage('secureContext', () => window.isSecureContext);
await stage('SpeechRecognition ctor', () => ({
  standard: typeof window.SpeechRecognition,
  webkit: typeof window.webkitSpeechRecognition,
}));
await stage('statics + processLocally', () => {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (typeof SR !== 'function') return 'no ctor';
  return {
    processLocallyOnPrototype: 'processLocally' in SR.prototype,
    availableStatic: typeof SR.available,
    installStatic: typeof SR.install,
  };
});
await stage('available({processLocally:true})', async () => {
  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (typeof SR?.available !== 'function') return 'no available()';
  try {
    return await SR.available({ langs: ['en-US'], processLocally: true });
  } catch (e) {
    return 'threw: ' + String(e);
  }
});

await browser.close();
