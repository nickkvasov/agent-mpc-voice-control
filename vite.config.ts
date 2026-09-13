import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config lives here rather than in a second file: one owner for the
// test include globs, so they cannot drift apart (IMMUNE-N).
export default defineConfig({
  plugins: [react()],
  server: {
    // Not 5173. That default is commonly occupied by another dev server, and
    // an e2e run that attaches to one tests someone else's application.
    port: 5273,
    // IMMUNE-U: if 5273 is taken, fail rather than quietly moving to 5274
    // while the test runner keeps talking to whatever holds 5273.
    strictPort: true,
    /**
     * Without this the Search button fetches /api/... from Vite, which answers
     * with the SPA's own HTML — a "successful" response that is not a catalog
     * result. Gate C found it; my Gate B run had stubbed this very route, so
     * driving the app could not have shown it (NOTES.md).
     */
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
    fs: {
      /**
       * The dev server serves the project root, and Vite's default deny list
       * covers `.env` and `.env.*` but not `dev.env` — so `GET /dev.env`
       * returned both API keys (codex, confirmed by requesting it). Setting
       * `deny` replaces the defaults, so they are restated here in full.
       */
      deny: [
        '.env', '.env.*', '*.env', '*.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // e2e is Playwright's; vitest must never try to run it.
    include: ['tests/contract/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
