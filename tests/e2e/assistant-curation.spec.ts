import type { Dialog, Page } from '@playwright/test';
import { expect, showResults, test } from './fixtures/player.ts';
import { ask, assistantConnected, turn } from './fixtures/assistant.ts';

/**
 * T138 — US4 through the assistant: a removal names what it will remove and
 * waits for the person; an unclear answer refuses; a bulk change over five
 * states the count and needs it said back.
 */
test.use({ assistant: 'scripted' });

const VIDEOS = [
  { videoId: 'firsttalk01', title: 'First talk' },
  { videoId: 'secondtalk1', title: 'Second talk' },
  { videoId: 'thirdtalk01', title: 'Third talk' },
  { videoId: 'fourthtalk1', title: 'Fourth talk' },
  { videoId: 'fifthtalk01', title: 'Fifth talk' },
  { videoId: 'sixthtalk01', title: 'Sixth talk' },
];

/** Answers the next confirmation with `answer`, keeping what it asked. */
function answerNextPrompt(page: Page, answer: string): { asked: () => string | null } {
  let asked: string | null = null;
  page.once('dialog', (dialog: Dialog) => {
    asked = dialog.message();
    void dialog.accept(answer);
  });
  return { asked: () => asked };
}

async function setUp(page: Page): Promise<void> {
  await page.goto('/');
  await assistantConnected(page);
  await showResults(page, VIDEOS);
}

test('a removal names its target and waits; "maybe" refuses, and a clear yes removes (FR-026, FR-028)', async ({ page }) => {
  await setUp(page);
  // By hand: a collection holding the first talk.
  await page.fill('[data-testid="collection-name"]', 'Favourites');
  await page.click('[data-testid="collection-create"]');
  await expect(page.locator('[data-testid="collection-item"]')).toHaveCount(1);
  await page.locator('[data-testid="result-item"]', { hasText: 'First talk' }).locator('[data-testid="add-to-collection"]').click();
  const inCollection = page.locator('[data-testid="collection-item"] [data-testid="collection-video"]');
  await expect(inCollection).toHaveCount(1);

  const unclear = answerNextPrompt(page, 'maybe');
  await ask(page, 'take the first talk out of favourites');
  await expect(turn(page, 'take the first talk out of favourites')).toHaveAttribute('data-state', 'done');
  // It asked, naming the video and the collection, before anything changed…
  // By title, as the person knows it — an id named nothing they could recognise (Gate B).
  expect(unclear.asked()).toBe('Remove "First talk" from "Favourites"?');
  // …and an unclear answer changed nothing, and is reported as answered, not as still waiting.
  const refusal = turn(page, 'take the first talk out of favourites').locator('[data-testid="turn-tool-call"]').last();
  await expect(refusal).toContainText('curation.removeFromCollection — refused');
  await expect(refusal).toContainText('the answer "maybe" did not confirm it');
  await expect(inCollection).toHaveCount(1);

  const clear = answerNextPrompt(page, 'yes');
  await ask(page, 'yes, take the first talk out of favourites');
  await expect(turn(page, 'yes, take the first talk out of favourites')).toHaveAttribute('data-state', 'done');
  expect(clear.asked()).toContain('"Favourites"');
  await expect(inCollection).toHaveCount(0);
});

test('a bulk change over five states the count, and a bare yes does not authorise it (FR-027)', async ({ page }) => {
  await setUp(page);
  const queued = page.locator('[data-testid="queue-item"]');

  const bare = answerNextPrompt(page, 'yes');
  await ask(page, 'queue all six talks');
  await expect(turn(page, 'queue all six talks')).toHaveAttribute('data-state', 'done');
  expect(bare.asked()).toContain('6');
  await expect(turn(page, 'queue all six talks').locator('[data-testid="turn-tool-call"]')).toContainText('queue.add — refused');
  await expect(queued).toHaveCount(0);

  const counted = answerNextPrompt(page, '6');
  await ask(page, 'queue all six talks, all 6');
  await expect(turn(page, 'queue all six talks, all 6')).toHaveAttribute('data-state', 'done');
  expect(counted.asked()).toContain('6');
  await expect(queued).toHaveCount(6);
});
