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

/** Short enough for the two lines the caption band holds at 19px (take 2 clipped mid-sentence at 110). */
export const clip = (s, n = 190) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
