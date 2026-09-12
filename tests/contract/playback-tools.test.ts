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
const noAd = { adPlaying: false, hasVideo: true };
const inAd = { adPlaying: true, hasVideo: true };
const noVideo = { adPlaying: false, hasVideo: false };

describe('playback tools', () => {
  it('pauses, and says nothing is playing rather than failing silently', async () => {
    expect((await pause(fakePlayer(), noAd)).ok).toBe(true);
    const idle = fakePlayer({ getPlayerState: () => 2 });
    const r = await pause(idle, noAd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.notPlaying);
  });

  it('plays a cued video, including one that is merely unstarted', async () => {
    // Gate C: state -1 means "not started", not "no video". A player cued with
    // an id is legitimately unstarted and must still be playable.
    for (const initial of [5, -1]) {
      let st = initial;
      const pl = fakePlayer({ getPlayerState: () => st, playVideo: () => void (st = 1) });
      expect((await play(pl, noAd)).ok, `initial state ${String(initial)}`).toBe(true);
    }
  });

  it('refuses to play when no video is loaded at all', async () => {
    const r = await play(fakePlayer(), noVideo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REFUSAL_REASON.notPlaying);
  });

  it('refuses success when the player ignores a pause', async () => {
    const stubborn = fakePlayer({ pauseVideo: () => {}, getPlayerState: () => 1 });
    const r = await pause(stubborn, noAd, 60);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/not established/);
  });

  it('stops and reports the resulting state', async () => {
    const r = await stop(fakePlayer(), noAd);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state).toBe('ended');
  });

  it('refuses during an advertisement, and says it can be retried', async () => {
    const r = await pause(fakePlayer(), inAd);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(REFUSAL_REASON.adInProgress);
      expect(r.retryable).toBe(true);
    }
  });

  it('seeks relatively and reports where it actually landed', async () => {
    const r = await seek(fakePlayer(), noAd, 'relative', 120);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.positionSeconds).toBe(150);
  });

  it('clamps a seek past the end and says it clamped', async () => {
    const r = await seek(fakePlayer(), noAd, 'absolute', 99999);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.clamped).toBe(true); expect(r.value.positionSeconds).toBe(600); }
  });

  it('states the rate actually applied, not the one asked for', async () => {
    const r = await setRate(fakePlayer(), 1.6);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rateApplied).toBe(1.5);
  });

  it('accepts a rate the player applies asynchronously', async () => {
    // Gate C: the real IFrame API applies a rate change out of band, so an
    // immediate getter returns the previous value and the tool wrongly reported
    // refusal. The synchronous fake could never show this.
    let rate = 1;
    const slow = fakePlayer({
      setPlaybackRate: (r: number) => void setTimeout(() => (rate = r), 60),
      getPlaybackRate: () => rate,
    });
    const r = await setRate(slow, 1.5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rateApplied).toBe(1.5);
  });

  it('distinguishes a change that never settles from one actively refused', async () => {
    const stuck = fakePlayer({ setPlaybackRate: () => {}, getPlaybackRate: () => 1 });
    const r = await setRate(stuck, 1.5, 80);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/not established/);
  });

  it('reports platform refusal of a volume change instead of success', async () => {
    const stubborn = fakePlayer({ setVolume: () => {}, getVolume: () => 50 });
    const r = await setVolume(stubborn, 80, 80);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe(REFUSAL_REASON.refusedByPlayer); expect(r.detail).toMatch(/would not let/); }
  });

  it('mutes and reads it back', async () => {
    expect((await setMuted(fakePlayer(), true)).ok).toBe(true);
  });

  it('distinguishes captions not yet reported from confirmed absence', () => {
    // getOption returning undefined means the module has not reported yet.
    const notYet = listTracks(fakePlayer());
    expect(notYet.ok).toBe(false);
    if (!notYet.ok) expect(notYet.reason).toBe(REFUSAL_REASON.effectUnverifiable);

    const none = listTracks(fakePlayer({ getOption: () => [] }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe(REFUSAL_REASON.capabilityUnsupported);
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
