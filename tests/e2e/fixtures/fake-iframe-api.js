/* global window, document, setTimeout -- served into the page, where these exist */
/*
 * A fake YouTube IFrame Player API for deterministic e2e runs (T110, research R10).
 *
 * Served in place of https://www.youtube.com/iframe_api. It answers the way the
 * real player does in the respects the application depends on: asynchronously,
 * through events, sometimes not at all. It is trusted ONLY for what the live
 * suite (tests/e2e-live/) also observes against the real embed — the stand-in it
 * replaces answered every call synchronously, which is how a green suite hid a
 * page with no player.
 *
 * Tests steer it through window.__fakeYT.
 */
(() => {
  const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const control = (window.__fakeYT = {
    /** The browser refuses to start playback without a gesture. */
    blockAutoplay: false,
    /** The next state change never arrives. */
    dropNextStateChange: false,
    /** Fire this player error code instead of loading. */
    errorOnLoad: null,
    /** Per-video error codes: { [videoId]: code }. */
    errorFor: {},
    players: [],
  });
  const later = (ms, fn) => setTimeout(fn, ms);

  class Player {
    constructor(element, options) {
      this.options = options ?? {};
      this.state = STATE.UNSTARTED;
      this.time = 0;
      this.duration = 0;
      this.rate = 1;
      this.volume = 100;
      this.muted = false;
      this.videoId = null;
      this.moduleOptions = new Map();
      control.players.push(this);
      const host = typeof element === 'string' ? document.getElementById(element) : element;
      const frame = document.createElement('iframe');
      frame.setAttribute('data-testid', 'fake-youtube-iframe');
      frame.title = 'YouTube video player (fake)';
      host?.replaceWith(frame);
      later(0, () => this.options.events?.onReady?.({ target: this }));
    }
    #playingSince = null;
    /** Like the real player, time advances while playing — the old fake's clock never moved. */
    #advance() {
      if (this.#playingSince !== null) {
        this.time = Math.min(this.duration, this.time + ((Date.now() - this.#playingSince) / 1000) * this.rate);
        this.#playingSince = this.state === STATE.PLAYING ? Date.now() : null;
      }
    }
    #emit(state) {
      if (control.dropNextStateChange) {
        control.dropNextStateChange = false;
        return;
      }
      this.#advance();
      this.state = state;
      this.#playingSince = state === STATE.PLAYING ? Date.now() : null;
      this.options.events?.onStateChange?.({ target: this, data: state });
    }
    loadVideoById(videoId) {
      this.videoId = videoId;
      this.time = 0;
      this.duration = 600;
      const code0 = control.errorFor[videoId] ?? control.errorOnLoad;
      if (code0 !== null && code0 !== undefined) {
        const code = code0;
        later(5, () => this.options.events?.onError?.({ target: this, data: code }));
        return;
      }
      // Like the real player, loading starts playback.
      this.playVideo();
    }
    cueVideoById(videoId) {
      this.videoId = videoId;
      this.time = 0;
      this.duration = 600;
      later(5, () => this.#emit(STATE.CUED));
    }
    playVideo() {
      if (control.blockAutoplay) {
        later(5, () => this.options.events?.onAutoplayBlocked?.({ target: this }));
        return;
      }
      later(5, () => this.#emit(STATE.BUFFERING));
      later(25, () => this.#emit(STATE.PLAYING));
    }
    pauseVideo() { later(5, () => this.#emit(STATE.PAUSED)); }
    stopVideo() { later(5, () => this.#emit(STATE.CUED)); }
    seekTo(seconds) { later(5, () => { this.#advance(); this.time = seconds; if (this.state === STATE.PLAYING) this.#playingSince = Date.now(); }); }
    getCurrentTime() { this.#advance(); return this.time; }
    getDuration() { return this.duration; }
    setPlaybackRate(rate) { later(5, () => { this.rate = rate; }); }
    getPlaybackRate() { return this.rate; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; }
    setVolume(volume) { later(5, () => { this.volume = volume; }); }
    getVolume() { return this.volume; }
    mute() { later(5, () => { this.muted = true; }); }
    unMute() { later(5, () => { this.muted = false; }); }
    isMuted() { return this.muted; }
    getPlayerState() { return this.state; }
    getVideoData() { return { video_id: this.videoId ?? '' }; }
    loadModule() {}
    unloadModule() {}
    setOption(module, option, value) { this.moduleOptions.set(`${module}.${option}`, value); }
    getOption(module, option) { return this.moduleOptions.get(`${module}.${option}`); }
    destroy() {}
  }

  window.YT = { Player, PlayerState: STATE, loaded: 1 };
  later(0, () => window.onYouTubeIframeAPIReady?.());
})();
