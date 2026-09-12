import { chromium } from 'playwright';

async function probe(label, opts) {
  let browser;
  try {
    browser = await chromium.launch(opts);
  } catch (e) {
    console.log(`${label}: cannot launch — ${e.message.split('\n')[0]}`);
    return;
  }
  const page = await browser.newPage();
  page.on('crash', () => console.log(`  ${label}: !! page crashed`));
  await page.goto('http://localhost:5273/');
  try {
    const v = await page.evaluate(async () => {
      const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      try {
        return { ok: await SR.available({ langs: ['en-US'], processLocally: true }) };
      } catch (e) { return { threw: String(e) }; }
    });
    console.log(`${label}: ${JSON.stringify(v)}`);
  } catch (e) {
    console.log(`${label}: CRASHED (${e.message.split('\n')[0]})`);
  }
  await browser.close();
}

console.log('--- probing available({processLocally:true}) ---');
await probe('headless chromium', { headless: true });
await probe('headed chromium  ', { headless: false });
await probe('system chrome    ', { headless: false, channel: 'chrome' });
