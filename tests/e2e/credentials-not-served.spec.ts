import { expect, test } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The dev server serves the project root. Vite denies `.env` and `.env.*` by
 * default, but not `dev.env` — which is where this project's credentials live —
 * so `GET /dev.env` returned both API keys until the config denied it (codex,
 * confirmed by requesting it). Probed with a throwaway file carrying a sentinel,
 * so the test neither needs nor touches real credentials.
 */
const SENTINEL = 'SENTINEL_SECRET_MUST_NOT_BE_SERVED';
const probes = ['zz-e2e-probe.env', 'dev.env.zz-e2e-probe'];

test.beforeAll(() => {
  for (const name of probes) writeFileSync(resolve(name), `ANTHROPIC_API_KEY=${SENTINEL}\n`);
});
test.afterAll(() => {
  for (const name of probes) rmSync(resolve(name), { force: true });
});

for (const name of probes) {
  for (const path of [`/${name}`, `/${name}?raw`, `/@fs${resolve(name)}`]) {
    test(`does not serve ${path.replace(process.cwd(), '<root>')}`, async ({ request }) => {
      const res = await request.get(path);
      expect(await res.text()).not.toContain(SENTINEL);
      expect(res.status()).toBe(403);
    });
  }
}
