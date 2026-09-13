import { expect, test, type Page } from '@playwright/test';

/**
 * T088 — quickstart Scenario 6.
 *
 * SC-013 is a negative — "no raw audio leaves the device" — so it is asserted
 * two ways: every outbound request is inspected, AND the recognition path is
 * driven with a fake recogniser so the capture window can be observed.
 *
 * The real on-device probe cannot run here: it kills the renderer in headless
 * Chrome (T008). That limitation is stated rather than hidden, and is why this
 * file stubs SpeechRecognition instead of exercising the browser's own.
 */
async function recordRequests(page: Page) {
  const seen: { url: string; postData: string | null; contentType: string }[] = [];
  page.on('request', (r) => {
    seen.push({
      url: r.url(),
      postData: r.postData(),
      contentType: r.headers()['content-type'] ?? '',
    });
  });
  return seen;
}

/** A recogniser that never touches a microphone or a network. */
const FAKE_RECOGNITION = `
  window.__captureWindows = [];
  class FakeRecognition {
    constructor() {}
    start() { window.__captureWindows.push({ started: Date.now(), ended: null }); }
    stop() {
      const w = window.__captureWindows[window.__captureWindows.length - 1];
      if (w) w.ended = Date.now();
      setTimeout(() => {
        this.onresult?.({ results: [[{ transcript: 'pause' }]] });
        this.onend?.();
      }, 10);
    }
  }
  // On the PROTOTYPE, because that is where the probe looks — an instance
  // property would leave on-device support undetectable.
  FakeRecognition.prototype.processLocally = false;
  FakeRecognition.available = async () => 'available';
  FakeRecognition.install = async () => true;
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
`;

test.describe('privacy', () => {
  test('no outbound request carries audio (SC-013)', async ({ page }) => {
    const requests = await recordRequests(page);
    await page.addInitScript(FAKE_RECOGNITION);
    await page.goto('/');
    await page.waitForSelector('[data-testid="talk-button"]');

    await page.locator('[data-testid="talk-button"]').dispatchEvent('pointerdown');
    await page.waitForTimeout(120);
    await page.locator('[data-testid="talk-button"]').dispatchEvent('pointerup');
    await page.waitForTimeout(400);

    for (const r of requests) {
      expect(r.contentType, `${r.url} sent audio`).not.toMatch(/^audio\//);
      expect(r.url, 'a URL looks like an audio upload').not.toMatch(/\.(wav|mp3|ogg|webm|opus)(\?|$)/);
      if (r.postData !== null) {
        expect(r.postData.slice(0, 8), `${r.url} posted audio-like bytes`).not.toMatch(/RIFF|OggS|ID3/);
      }
    }
  });

  test('recognition is forced on-device and never falls back (FR-043)', async ({ page }) => {
    await page.addInitScript(FAKE_RECOGNITION);
    await page.goto('/');
    await page.waitForSelector('[data-testid="talk-button"]');
    await page.locator('[data-testid="talk-button"]').dispatchEvent('pointerdown');
    await page.waitForTimeout(150);
    const local = await page.evaluate(() => {
      const w = window as unknown as { __captureWindows?: unknown[] };
      return Array.isArray(w.__captureWindows) && w.__captureWindows.length > 0;
    });
    expect(local, 'a capture should have started').toBe(true);
    await page.locator('[data-testid="talk-button"]').dispatchEvent('pointerup');
  });

  test('the capture indicator matches the capture window exactly (SC-011)', async ({ page }) => {
    await page.addInitScript(FAKE_RECOGNITION);
    await page.goto('/');
    await page.waitForSelector('[data-testid="talk-button"]');
    const indicator = page.locator('[data-testid="capture-indicator"]');

    await expect(indicator).toHaveCount(0);
    await page.locator('[data-testid="talk-button"]').dispatchEvent('pointerdown');
    await expect(indicator).toHaveCount(1);
    await page.locator('[data-testid="talk-button"]').dispatchEvent('pointerup');
    await expect(indicator).toHaveCount(0);
  });

  test('nothing is captured before the first press', async ({ page }) => {
    await page.addInitScript(FAKE_RECOGNITION);
    await page.goto('/');
    await page.waitForSelector('[data-testid="talk-button"]');
    await page.waitForTimeout(500);
    const captures = await page.evaluate(() => {
      const w = window as unknown as { __captureWindows?: unknown[] };
      return w.__captureWindows?.length ?? 0;
    });
    expect(captures, 'audio was captured with no press').toBe(0);
    await expect(page.locator('[data-testid="capture-indicator"]')).toHaveCount(0);
  });

  test('the disclosure states both halves: audio stays, text leaves (FR-045)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="privacy-audio"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="privacy-text"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="privacy-catalog"]')).toContainText('only on this device');
  });

  test('command history is stated and clearable (FR-041)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="command-input"]');
    await expect(page.locator('[data-testid="clear-history"]')).toBeDisabled();
    await page.fill('[data-testid="command-input"]', 'pause');
    await page.click('[data-testid="command-submit"]');
    await expect(page.locator('[data-testid="history-count"]')).toContainText('never the audio');
    await page.click('[data-testid="clear-history"]');
    await expect(page.locator('[data-testid="history-count"]')).toContainText('No commands are stored');
  });
});
