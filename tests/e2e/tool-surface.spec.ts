import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/player.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';
import { VIEW_TOOLS } from '../../src/mcp/tool-descriptions.ts';

/**
 * The page is an MCP server (T095, FR-035, Principle II).
 *
 * Read through the page's own tool registry — `document.modelContext`, where a
 * browser agent looks — never through the handlers. Until Phase 9 this
 * registry was empty: the provider was never mounted and no view declared a
 * tool, while every handler test passed.
 */
/**
 * The provider adopts the registry asynchronously (the library README names
 * this), so before adoption there is no `document.modelContext` yet. That reads
 * as an empty list while polling; a registry that never appears still fails,
 * because the count never arrives.
 */
const listed = (page: Page) =>
  page.evaluate(async () =>
    (document.modelContext === undefined ? [] : await document.modelContext.getTools()).map((t) => t.name).sort(),
  );

async function waitForTools(page: Page, count: number) {
  await expect.poll(async () => (await listed(page)).length, { timeout: 5000 }).toBe(count);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('every tool in the contract is registered while its view is on screen', async ({ page }) => {
  const all = Object.values(TOOL).sort();
  await waitForTools(page, all.length);
  expect(await listed(page)).toEqual(all);
});

test('closing a panel removes exactly its tools; reopening restores them', async ({ page }) => {
  const all = Object.values(TOOL).length;
  await waitForTools(page, all);

  await page.locator('[data-testid="toggle-collections"]').click();
  await waitForTools(page, all - VIEW_TOOLS.curation.length);
  const withoutCuration = await listed(page);
  for (const t of VIEW_TOOLS.curation) expect(withoutCuration).not.toContain(t);
  for (const t of VIEW_TOOLS.queue) expect(withoutCuration).toContain(t);

  await page.locator('[data-testid="toggle-queue"]').click();
  await waitForTools(page, all - VIEW_TOOLS.curation.length - VIEW_TOOLS.queue.length);
  for (const t of VIEW_TOOLS.queue) expect(await listed(page)).not.toContain(t);

  await page.locator('[data-testid="toggle-collections"]').click();
  await page.locator('[data-testid="toggle-queue"]').click();
  await waitForTools(page, all);
});

test('a call naming a command this page never issued is refused, applied nowhere, and recorded', async ({ page }) => {
  await waitForTools(page, Object.values(TOOL).length);
  const result = await page.evaluate(async () => {
    const mc = document.modelContext;
    const tool = (await mc.getTools()).find((t) => t.name === 'playback.pause');
    if (tool === undefined) throw new Error('playback.pause is not registered');
    const raw = await mc.executeTool(tool, JSON.stringify({ commandId: 'cmd-never-issued' }));
    if (raw === null) throw new Error('playback.pause returned no result at all');
    return JSON.parse(raw) as { ok: boolean; reason: string };
  });
  expect(result).toMatchObject({ ok: false, reason: 'unknown_command' });
  // Visible without any further action: the record view follows the record.
  await expect(page.locator('[data-testid="activity-entry"]')).toHaveCount(1);
  // In the interface's words (FR-029). This line used to assert the raw id
  // 'playback.pause' — a test guarding the defect Gate B then found on screen.
  const entry = page.locator('[data-testid="activity-entry"]').first();
  await expect(entry).toContainText('Pause playback');
  await expect(entry).not.toContainText('playback.pause');
  await expect(entry).toContainText('No command cmd-never-issued was issued');
});

test('a call without commandId never reaches a handler', async ({ page }) => {
  await waitForTools(page, Object.values(TOOL).length);
  const outcome = await page.evaluate(async () => {
    const mc = document.modelContext;
    const tool = (await mc.getTools()).find((t) => t.name === 'queue.clear');
    if (tool === undefined) throw new Error('queue.clear is not registered');
    try {
      await mc.executeTool(tool, JSON.stringify({}));
      return 'applied';
    } catch (e) {
      return String(e);
    }
  });
  expect(outcome).toMatch(/commandId/);
});
