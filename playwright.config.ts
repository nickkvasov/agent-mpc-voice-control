import { defineConfig } from '@playwright/test';
import { ASSISTANT_SCRIPT, BACKEND_URL, E2E_TURNS_PER_SESSION } from './tests/e2e/fixtures/assistant.ts';

const BASE_URL = 'http://localhost:5273';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: BASE_URL },
  webServer: [
    {
      command: 'npm run dev',
      url: BASE_URL,
      // Never reuse. An already-running server on this port is not necessarily
      // this application — that exact mistake made a run assert against an
      // unrelated app's DOM. Starting our own is the only way the gate tests
      // the code under test.
      reuseExistingServer: false,
    },
    {
      // The backend with a SCRIPTED model (Phase 13). Started directly, never
      // through `npm run server`: that loads dev.env, whose real key would
      // make the scripted model refuse to start — as it should. Both keys are
      // set empty so a key exported in the shell cannot leak in either.
      command: 'node server/index.ts',
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: false,
      env: {
        AMR_SCRIPTED_MODEL: ASSISTANT_SCRIPT,
        ANTHROPIC_API_KEY: '',
        YOUTUBE_API_KEY: '',
        ASSISTANT_TURNS_PER_SESSION: String(E2E_TURNS_PER_SESSION),
      },
    },
  ],
});
