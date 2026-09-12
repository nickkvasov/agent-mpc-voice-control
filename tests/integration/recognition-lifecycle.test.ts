import { describe, expect, it, vi } from 'vitest';
import { startOnDeviceRecognition } from '../../src/voice/recognition.ts';
import { stop as stopVideo } from '../../src/player/tools/transport.ts';

/** Regression cover for the Gate C round-2 findings on recognition. */
function fakeRecognitionGlobal() {
  const created: Record<string, unknown>[] = [];
  const make = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    self['start'] = vi.fn();
    self['stop'] = vi.fn(() => {
      // Real recognisers emit the final result AFTER stop() returns.
      setTimeout(() => {
        (self['onresult'] as ((e: unknown) => void) | undefined)?.({ results: [[{ transcript: 'pause' }]] });
        (self['onend'] as (() => void) | undefined)?.();
      }, 20);
    });
    created.push(self);
    return self;
  };
  const SR = function () {
    return make();
  } as unknown as { new (): unknown; prototype: Record<string, unknown> };
  SR.prototype = { processLocally: false };
  return { g: { SpeechRecognition: SR } as unknown as typeof globalThis, created };
}

describe('recognition lifecycle', () => {
  it('delivers the transcript that arrives AFTER stop() returns', async () => {
    const { g } = fakeRecognitionGlobal();
    const started = startOnDeviceRecognition(g);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Released promptly: a synchronous read would have returned ''.
    await expect(started.session.stop()).resolves.toBe('pause');
  });

  it('forces processLocally on, never the default mode', () => {
    const { g, created } = fakeRecognitionGlobal();
    startOnDeviceRecognition(g);
    expect(created[0]?.['processLocally']).toBe(true);
  });

  it('surfaces a microphone refusal that arrives through onerror', async () => {
    const { g, created } = fakeRecognitionGlobal();
    const details: string[] = [];
    const started = startOnDeviceRecognition(g, { onError: (d) => details.push(d) });
    expect(started.ok).toBe(true);
    (created[0]?.['onerror'] as (e: { error: string }) => void)({ error: 'not-allowed' });
    expect(details[0]).toMatch(/microphone was refused/);
    if (started.ok) await expect(started.session.stop()).resolves.toBe('');
  });

  it('abort closes a session opened after the hold already ended', () => {
    const { g, created } = fakeRecognitionGlobal();
    const started = startOnDeviceRecognition(g);
    if (!started.ok) return;
    started.session.abort();
    expect(created[0]?.['stop']).toHaveBeenCalled();
  });

  it('accepts every documented stopped state, not just ended', async () => {
    for (const code of [0, -1, 2, 5]) {
      const p = {
        stopVideo: () => {},
        getPlayerState: () => code,
        getCurrentTime: () => 0,
      } as unknown as Parameters<typeof stopVideo>[0];
      const r = await stopVideo(p, { adPlaying: false, hasVideo: true }, 60);
      expect(r.ok, `state ${String(code)}`).toBe(true);
    }
  });
});
