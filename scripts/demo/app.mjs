// The whole coupling between this application and the demo-video harness: where it runs, when it is
// ready, what scrolls, and how to tell an assistant turn is still going. Beats live beside it.
import { existsSync, readFileSync } from 'node:fs';

export const HARNESS =
  process.env.DEMO_HARNESS ??
  `${process.env.CLAUDE_PLUGIN_ROOT ?? '<set CLAUDE_PLUGIN_ROOT or DEMO_HARNESS>'}/skills/demo-video/recorder.mjs`;

/** Refuses to record against a stack that cannot demonstrate the assistant. Never prints a key. */
export async function preflight() {
  for (const url of ['http://localhost:5273/', 'http://localhost:8787/health']) {
    const res = await fetch(url).catch(() => null);
    if (res === null || !res.ok) throw new Error(`${url} is not answering — start the stack with npm run dev:all`);
  }
  if (!existsSync('dev.env')) throw new Error('dev.env is missing: the backend would have no model and no YouTube key');
  const env = readFileSync('dev.env', 'utf8');
  for (const name of ['ANTHROPIC_API_KEY', 'YOUTUBE_API_KEY']) {
    if (!new RegExp(`^${name}=\\S+`, 'm').test(env)) throw new Error(`${name} is not set in dev.env`);
  }
}

export const config = {
  url: 'http://localhost:5273/',
  out: '.demo/',
  // Ready means the assistant is connected AND the real embed has loaded — a demo of a page still
  // connecting is a demo of nothing. `#root` becomes the scroller so the caption band's space comes
  // out of it rather than covering the page.
  ready: async (page) => {
    await page.locator('[data-testid="connection-status"][data-state="connected"]').waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="player"][data-ready="true"]').waitFor({ timeout: 30_000 });
    await page.addStyleTag({ content: 'body { margin: 0 } #root { overflow-y: auto }' });
  },
  reserve: '#root',
  scroller: '#root',
  input: '[data-testid="command-input"]',
  submit: '[data-testid="command-submit"]',
  // The newest unfinished turn renders first; its label reads "Asking…" / "…working…" / "Still working".
  busy: { selector: '[data-testid="assistant-turn"] [data-testid="turn-state"]', text: 'Asking|working|Still' },
  // A turn the assistant could not run or finish — not a tool the page refused, which is an outcome.
  error: { selector: '[data-testid="turn-refusal"]' },
  preflight,
};

/** Every generated asset carries the local date and time it was made, so a take never overwrites another: 2026-09-14-1118. */
export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export const turn = (page, text) =>
  page.locator('[data-testid="assistant-turn"]', { has: page.locator('strong', { hasText: `“${text}”` }) });

/** The tool calls a turn shows, as "name ✓" or "name — refused: …". */
export const callsOf = (page, text) => turn(page, text).locator('[data-testid="turn-tool-call"]').allInnerTexts();

export const messageOf = async (page, text) =>
  (await turn(page, text).locator('[data-testid="turn-message"]').allInnerTexts()).join(' ').replace(/\s+/g, ' ').trim();

/** Lines a caption screen may use: the harness band is 84px at 19px/1.35, and the skill's rule is two. */
const CAPTION_LINES = 2;

/**
 * Splits a caption into screens that each fit the band, measured in the page rather than guessed
 * from a character count. Whole sentences are kept together where they fit; a sentence too long for
 * one screen breaks between words, marked "…" at the end of one screen and the start of the next.
 * Take 5 cut its last caption off mid-sentence with a fixed 230-character clip.
 */
export async function captionScreens(page, who, text) {
  return page.evaluate(([whoArg, raw, lines]) => {
    // Measured in the REAL bar: a copy with another id lost the harness's id-based styles, measured
    // an unstyled span against a NaN line height, and split every word onto its own screen. This whole
    // function runs synchronously, so no frame is painted with a trial text in it; the bar is restored
    // before returning.
    const chip = document.querySelector('#__demo_chip');
    const span = document.querySelector('#__demo_text');
    const saved = { who: chip.dataset.who, chip: chip.textContent, text: span.textContent };
    chip.dataset.who = whoArg;
    chip.textContent = whoArg === 'human' ? 'person' : whoArg;
    const limit = parseFloat(window.getComputedStyle(span).lineHeight) * lines + 1;
    if (!Number.isFinite(limit)) throw new Error('caption line height is not measurable');
    const fits = (t) => { span.textContent = t; return span.getBoundingClientRect().height <= limit; };
    const restore = (result) => {
      if (saved.who === undefined) delete chip.dataset.who; else chip.dataset.who = saved.who;
      chip.textContent = saved.chip;
      span.textContent = saved.text;
      return result;
    };

    const text = raw.replace(/\s+/g, ' ').trim();
    if (fits(text)) return restore([text]);
    const sentences = text.match(/[^.!?]+(?:[.!?]+["”’)]*|$)\s*/g).map((s) => s.trim()).filter(Boolean);
    const screens = [];
    let current = '';
    let continues = false; // the current screen starts mid-sentence
    const flush = (tail) => { screens.push(current + tail); current = ''; };
    for (const sentence of sentences) {
      const joined = current === '' ? sentence : `${current} ${sentence}`;
      if (fits(joined)) { current = joined; continue; }
      if (current !== '' && fits(sentence)) { flush(''); current = sentence; continue; }
      // Too long for a screen of its own: break it between words.
      for (const word of sentence.split(' ')) {
        const next = current === '' ? (continues ? `… ${word}` : word) : `${current} ${word}`;
        if (fits(`${next} …`) || current === '') { current = next; continue; }
        flush(' …');
        continues = true;
        current = `… ${word}`;
      }
      continues = false;
    }
    if (current !== '') screens.push(current);
    return restore(screens);

  }, [who, text, CAPTION_LINES]);
}

/**
 * `say`, but a caption that does not fit the band plays as consecutive screens. Each screen is held
 * long enough to read (about 15 characters a second, 2.4–5 s); the last keeps the caller's hold, so a
 * hold of 0 still hands control straight back while an action runs.
 */
export const captions = (page, say) => async (who, text, hold = 3200) => {
  const screens = await captionScreens(page, who, text);
  for (const [i, screen] of screens.entries()) {
    const last = i === screens.length - 1;
    const reading = Math.min(5000, Math.max(2400, screen.length * 65));
    await say(who, screen, last ? (screens.length === 1 ? hold : Math.max(hold, reading)) : reading);
  }
};

