import { defineConfig } from '@playwright/test';

/**
 * The live suite (T093): the real YouTube embed, the real backend, the real
 * key. Kept apart from `playwright.config.ts` so `test:e2e` never needs network
 * or credentials, and so a deterministic run can never be mistaken for this one.
 *
 * It runs at Gate B and at the final gate. It spends quota and assistant turns.
 */
const BASE_URL = 'http://localhost:5273';

export default defineConfig({
  testDir: 'tests/e2e-live',
  use: { baseURL: BASE_URL },
  // One at a time: the tests share one backend, one search budget and one
  // assistant allowance, and parallel runs would measure each other.
  workers: 1,
  webServer: {
    command: 'npm run dev:all',
    url: BASE_URL,
    // Same reason as playwright.config.ts: an existing server on this port is
    // not necessarily this application.
    reuseExistingServer: false,
  },
});
