import { describe, expect, it } from 'vitest';
import { createEmbeddedPlayer } from '../../src/player/youtube-adapter.ts';
import type { YTNamespace } from '../../src/player/iframe-api.ts';

/** Phase 10 Gate C round 1: an embed that never becomes ready is a stated failure, not "loading" forever. */
describe('embedded player readiness', () => {
  it('rejects with a reason when the player never reports ready', async () => {
    const neverReady = { Player: class { constructor() {} } } as unknown as YTNamespace;
    const origin = globalThis.window;
    (globalThis as { window?: unknown }).window = { location: { origin: 'http://localhost:5273' } };
    try {
      await expect(
        createEmbeddedPlayer(neverReady, {} as HTMLElement, { changed: () => {}, error: () => {} }, 20),
      ).rejects.toThrow(/did not become ready/);
    } finally {
      (globalThis as { window?: unknown }).window = origin;
    }
  });
});
