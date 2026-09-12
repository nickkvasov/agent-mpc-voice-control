import { describe, expect, it } from 'vitest';
import { play, pause, stop } from '../../src/player/tools/transport.ts';
import { seek } from '../../src/player/tools/seek.ts';
import { setRate, setVolume, setMuted } from '../../src/player/tools/rate-volume.ts';
import { setCaptions, listTracks } from '../../src/player/tools/captions.ts';
import { seekToChapter } from '../../src/player/tools/chapters.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';
import { UNKNOWN } from '../../src/store/video-reference.ts';
import type { YouTubePlayer } from '../../src/player/player.ts';

function fakePlayer(over: Partial<Record<string, unknown>> = {}): YouTubePlayer {
  let state = 1, time = 30, rate = 1, volume = 50, muted = false;
  const options = new Map<string, unknown>();
  const p: YouTubePlayer = {
    playVideo: () => void (state = 1),
    pauseVideo: () => void (state = 2),
    stopVideo: () => void (state = 0),
    seekTo: (s) => void (time = s),
    getCurrentTime: () => time,
    getDuration: () => 600,
    setPlaybackRate: (r) => void (rate = r),
    getPlaybackRate: () => rate,
    getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2],
    setVolume: (v) => void (volume = v),
    getVolume: () => volume,
    mute: () => void (muted = true),
    unMute: () => void (muted = false),
    isMuted: () => muted,
    getPlayerState: () => state,
    loadModule: () => {},
    unloadModule: () => {},
    setOption: (m, o, v) => void options.set(`${m}.${o}`, v),
    getOption: (m, o) => options.get(`${m}.${o}`),
    ...over,
  } as YouTubePlayer;
  return p;
}
const noAd = { adPlaying: false };
const inAd = { adPlaying: true };

describe('playback tools', () => {
  it('pauses, and says nothing is playing rather than failing silently', () => {
    expect(pause(fakePlayer(), noAd).ok).toBe(true);
    const idle = fakePlayer({ getPlayerState: () => 2 });
    const r = pause(idle, noAd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.notPlaying);
  });

  it('plays, and refuses when nothing is cued rather than pretending', () => {
    const cued = fakePlayer({ getPlayerState: () => 5 });
    expect(play(cued, noAd).ok).toBe(true);
    const empty = fakePlayer({ getPlayerState: () => -1 });
    const r = play(empty, noAd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.notPlaying);
  });

  it('stops and reports the resulting state', () => {
    const r = stop(fakePlayer(), noAd);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state).toBe('ended');
  });

  it('refuses during an advertisement, and says it can be retried', () => {
    const r = pause(fakePlayer(), inAd);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(REFUSAL_REASON.adInProgress);
      expect(r.retryable).toBe(true);
    }
  });

  it('seeks relatively and reports where it actually landed', () => {
    const r = seek(fakePlayer(), noAd, 'relative', 120);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.positionSeconds).toBe(150);
  });

  it('clamps a seek past the end and says it clamped', () => {
    const r = seek(fakePlayer(), noAd, 'absolute', 99999);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.clamped).toBe(true); expect(r.value.positionSeconds).toBe(600); }
  });

  it('states the rate actually applied, not the one asked for', () => {
    const r = setRate(fakePlayer(), 1.6);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rateApplied).toBe(1.5);
  });

  it('reports platform refusal of a volume change instead of success', () => {
    const stubborn = fakePlayer({ setVolume: () => {}, getVolume: () => 50 });
    const r = setVolume(stubborn, 80);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe(REFUSAL_REASON.refusedByPlayer); expect(r.detail).toMatch(/would not let/); }
  });

  it('mutes and reads it back', () => {
    expect(setMuted(fakePlayer(), true).ok).toBe(true);
  });

  it('says a video offers no captions rather than appearing to succeed', () => {
    const r = listTracks(fakePlayer());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.capabilityUnsupported);
  });

  it('enables a caption track and verifies the readback', () => {
    const withTracks = fakePlayer({
      getOption: (_m: string, o: string) =>
        o === 'tracklist' ? [{ languageCode: 'en', displayName: 'English' }] : { languageCode: 'en' },
    });
    const r = setCaptions(withTracks, { enabled: true });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.track).toBe('en'); expect(r.value.verified).toBe(true); }
  });

  it('does not claim captions were turned off when it cannot confirm it', () => {
    const r = setCaptions(fakePlayer(), { enabled: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(REFUSAL_REASON.effectUnverifiable);
      // The detail must say what happened, and must NOT imply captions stayed on.
      expect(r.detail).toMatch(/Sent the request/);
      expect(r.detail).toMatch(/could not confirm/);
      expect(r.detail).not.toMatch(/still on|remain on|failed to/i);
    }
  });

  it('distinguishes chapters unknown from chapters absent', () => {
    const unknown = seekToChapter(fakePlayer(), UNKNOWN, 'pricing');
    const none = seekToChapter(fakePlayer(), [], 'pricing');
    expect(unknown.ok).toBe(false);
    expect(none.ok).toBe(false);
    if (!unknown.ok) expect(unknown.detail).toMatch(/not yet known/);
    if (!none.ok) expect(none.detail).toMatch(/publishes no chapters/);
  });

  it('seeks to a described chapter and names the one it chose', () => {
    const r = seekToChapter(fakePlayer(), [{ title: 'Intro', startSeconds: 0 }, { title: 'Pricing and plans', startSeconds: 300 }], 'pricing');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.chapterTitle).toBe('Pricing and plans');
  });

  it('asks rather than choosing when two chapters match equally', () => {
    const r = seekToChapter(fakePlayer(), [{ title: 'Pricing one', startSeconds: 0 }, { title: 'Pricing two', startSeconds: 60 }], 'pricing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.ambiguousReference);
  });
});
