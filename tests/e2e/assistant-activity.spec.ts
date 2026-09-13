import type { Page } from '@playwright/test';
import { expect, loadVideo, test, VIDEO } from './fixtures/player.ts';
import { ask, assistantConnected, turn } from './fixtures/assistant.ts';

/**
 * T137 — US3 through the assistant: its calls land in the activity record once
 * each, under the command they served; an entry it made can be undone; its
 * account of what it did is read from that record; and a call refused before any
 * handler ran is still recorded, with its arguments and its command.
 */
test.use({ assistant: 'scripted' });

/** How the record names the loaded video: by title (Phase 13 Gate B). */
const QUEUED = `Queue "${VIDEO.title}"`;

const commandOf = async (page: Page, text: string): Promise<string> => {
  const id = await turn(page, text).getAttribute('data-command-id');
  expect(id).toBeTruthy();
  return id as string;
};

async function queueAndGoBack(page: Page): Promise<string> {
  await page.goto('/');
  await assistantConnected(page);
  await loadVideo(page);
  await page.click('[data-testid="btn-fwd"]');
  await page.click('[data-testid="btn-fwd"]');
  // Both manual seeks recorded before the turn starts. The record is in the
  // order things applied, so a seek still settling would land between the
  // assistant's two calls and push one out of "the last two".
  await expect(page.locator('[data-testid="activity-description"]').filter({ hasText: 'Seek forward 15s' })).toHaveCount(2);
  await ask(page, 'queue this and go back a bit');
  await expect(turn(page, 'queue this and go back a bit')).toHaveAttribute('data-state', 'done');
  return commandOf(page, 'queue this and go back a bit');
}

test('every assistant call appears once under its command, and an assistant entry can be undone (FR-029, FR-030)', async ({ page }) => {
  const commandId = await queueAndGoBack(page);
  const entries = page.locator(`[data-testid="activity-entry"][data-command-id="${commandId}"]`);
  await expect(entries).toHaveCount(2);
  await expect(entries.locator('[data-testid="activity-description"]')).toHaveText([/Seek back 10s/, QUEUED]);
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(1);

  await entries.filter({ hasText: QUEUED }).locator('[data-testid="undo-button"]').click();
  await expect(page.locator('[data-testid="queue-item"]')).toHaveCount(0);
  await expect(entries.filter({ hasText: QUEUED })).toContainText('since undone');
});

test('"what did you just do?" is answered from the record (FR-033)', async ({ page }) => {
  await queueAndGoBack(page);
  await ask(page, 'what did you just do?');
  const answer = turn(page, 'what did you just do?').locator('[data-testid="turn-message"]');
  await expect(answer).toContainText('Seek back 10s');
  // The scripted model repeats the tool's answer verbatim, as JSON.
  const text = (JSON.parse(await answer.innerText()) as { value: { summary: string } }).value.summary;
  // Most recent first, as the record orders them.
  expect(text.indexOf('Seek back 10s')).toBeLessThan(text.indexOf(QUEUED));
  expect(text.indexOf(QUEUED)).toBeGreaterThan(-1);
});

test('an assistant call refused before its handler is recorded with its arguments and its command', async ({ page }) => {
  await page.goto('/');
  await assistantConnected(page);
  await loadVideo(page);

  await ask(page, 'seek sideways');
  await expect(turn(page, 'seek sideways')).toHaveAttribute('data-state', 'done');
  await expect(turn(page, 'seek sideways').locator('[data-testid="turn-tool-call"]')).toContainText('playback.seek — refused');
  const commandId = await commandOf(page, 'seek sideways');
  const entry = page.locator(`[data-testid="activity-entry"][data-command-id="${commandId}"]`);
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('refused');

  // The arguments are not on screen; the record's own listing carries them.
  await ask(page, 'list what you did');
  const listing = turn(page, 'list what you did').locator('[data-testid="turn-message"]');
  await expect(listing).toContainText('"entries"');
  const parsed = JSON.parse(await listing.innerText()) as { ok: boolean; value: { entries: { commandId: string | null; toolName: string; arguments: Record<string, unknown>; refusalReason?: string }[] } };
  const recorded = parsed.value.entries.filter((e) => e.commandId === commandId);
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ toolName: 'playback.seek', refusalReason: 'arguments_invalid' });
  expect(recorded[0]?.arguments).toMatchObject({ mode: 'sideways', seconds: 5, commandId });
});
