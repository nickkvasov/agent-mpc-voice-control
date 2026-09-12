import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://localhost:5273';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: BASE_URL },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    // Never reuse. An already-running server on this port is not necessarily
    // this application — that exact mistake made a run assert against an
    // unrelated app's DOM. Starting our own is the only way the gate tests
    // the code under test.
    reuseExistingServer: false,
  },
});
