import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * The conversational e2e (Phase 13): the real page, the real gateway and turn
 * endpoint, and a SCRIPTED model — never the real one, which lives in
 * `tests/e2e-live`. The backend is started by `playwright.config.ts` with no
 * env file and an explicitly empty key, so the scripted model can start (it
 * refuses beside a real key) and nothing here spends quota or turns.
 */
export const ASSISTANT_SCRIPT = resolve(import.meta.dirname, 'assistant-script.json');

/**
 * Low enough that the allowance test can spend it in a few turns, high enough
 * that no other test comes near it. Each test is its own browser context, so
 * its own session.
 */
export const E2E_TURNS_PER_SESSION = 8;

export const BACKEND_URL = 'http://localhost:8787';

/** Waits until the page's MCP connection to the backend is up, so a command goes to the assistant. */
export async function assistantConnected(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('data-state', 'connected', { timeout: 10_000 });
}

/** Types a command the matcher does not know, so it goes to the assistant. */
export async function ask(page: Page, text: string): Promise<void> {
  await page.fill('[data-testid="command-input"]', text);
  await page.click('[data-testid="command-submit"]');
}

/** The turn for this command text. */
export const turn = (page: Page, text: string) =>
  page.locator('[data-testid="assistant-turn"]', { has: page.locator('strong', { hasText: `“${text}”` }) });
