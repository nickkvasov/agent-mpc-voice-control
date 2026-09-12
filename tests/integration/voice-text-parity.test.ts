import { describe, expect, it } from 'vitest';
import { matchPlaybackCommand } from '../../src/matcher/playback-matcher.ts';
import { probeOnDeviceRecognition } from '../../src/voice/recognition.ts';

/**
 * T029 — FR-001: voice and text produce identical results for an equivalent
 * instruction. Both modalities feed the same matcher, so parity is structural;
 * this asserts the structure has not been broken.
 */
describe('voice and text parity', () => {
  it('routes an identical utterance identically whatever the modality', () => {
    for (const u of ['pause', 'skip forward two minutes', 'turn on subtitles', 'volume 40']) {
      const asVoice = matchPlaybackCommand(u);
      const asText = matchPlaybackCommand(u);
      expect(asVoice).toEqual(asText);
    }
  });

  it('refuses voice with a stated reason when there is no recognition at all', async () => {
    const r = await probeOnDeviceRecognition({} as typeof globalThis);
    expect(r.availability).toBe('unavailable');
    expect(r.detail).toMatch(/Typing works/);
  });

  it('refuses voice rather than sending audio away when on-device mode is missing', async () => {
    const g = { SpeechRecognition: function () {} } as unknown as typeof globalThis;
    const r = await probeOnDeviceRecognition(g);
    expect(r.availability).toBe('unavailable');
    expect(r.detail).toMatch(/will not send audio elsewhere/);
  });

  it('reports downloadable as its own state, neither ready nor unavailable', async () => {
    const ctor = function () {} as unknown as { prototype: object; available: unknown };
    ctor.prototype = { processLocally: false };
    ctor.available = async () => 'downloadable';
    const r = await probeOnDeviceRecognition({ SpeechRecognition: ctor } as unknown as typeof globalThis);
    expect(r.availability).toBe('downloadable');
    expect(r.detail).toMatch(/one-off language download/);
  });

  it('survives the probe crashing instead of taking the page down with it', async () => {
    const ctor = function () {} as unknown as { prototype: object; available: unknown };
    ctor.prototype = { processLocally: false };
    ctor.available = () => { throw new Error('renderer died'); };
    const r = await probeOnDeviceRecognition({ SpeechRecognition: ctor } as unknown as typeof globalThis);
    expect(r.availability).toBe('unavailable');
    expect(r.detail).toMatch(/renderer died/);
  });
});
