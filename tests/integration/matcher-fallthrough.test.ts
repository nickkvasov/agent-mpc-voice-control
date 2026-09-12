import { describe, expect, it } from 'vitest';
import { matchPlaybackCommand } from '../../src/matcher/playback-matcher.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';

/**
 * T045 — the matcher must never guess.
 *
 * This is the containment for the Complexity Tracking entry in plan.md: two
 * interpreters of one utterance are safe only while they never both interpret
 * the same one. The matcher takes what it is certain of and declines the rest.
 */
describe('local matcher', () => {
  it('matches the closed playback vocabulary', () => {
    const cases: [string, string][] = [
      ['pause', TOOL.playbackPause],
      ['Pause.', TOOL.playbackPause],
      ['play', TOOL.playbackPlay],
      ['stop', TOOL.playbackStop],
      ['next', TOOL.playbackNext],
      ['mute', TOOL.playbackSetMuted],
      ['skip forward two minutes', TOOL.playbackSeek],
      ['go back fifteen seconds', TOOL.playbackSeek],
      ['speed 1.5', TOOL.playbackSetRate],
      ['turn on subtitles', TOOL.playbackSetCaptions],
      ['volume 40', TOOL.playbackSetVolume],
    ];
    for (const [utterance, tool] of cases) {
      const r = matchPlaybackCommand(utterance);
      expect(r.matched, utterance).toBe(true);
      if (r.matched) expect(r.match.tool, utterance).toBe(tool);
    }
  });

  it('preserves a decimal rate rather than eating the point', () => {
    // Regression: normalisation stripped the '.', so "speed 1.5" became 15.
    for (const [utterance, rate] of [['speed 1.5', 1.5], ['speed 0.5', 0.5], ['set speed to 1.25', 1.25], ['2x speed', 2]] as [string, number][]) {
      const r = matchPlaybackCommand(utterance);
      expect(r.matched, utterance).toBe(true);
      if (r.matched) expect(r.match.input['rate'], utterance).toBe(rate);
    }
  });

  it('still strips sentence punctuation', () => {
    expect(matchPlaybackCommand('Pause.').matched).toBe(true);
    expect(matchPlaybackCommand('pause!').matched).toBe(true);
  });

  it('computes seek amounts correctly in both directions', () => {
    const fwd = matchPlaybackCommand('skip forward two minutes');
    const back = matchPlaybackCommand('go back fifteen seconds');
    if (fwd.matched) expect(fwd.match.input['seconds']).toBe(120);
    if (back.matched) expect(back.match.input['seconds']).toBe(-15);
  });

  it('falls through rather than guessing an unquantified amount', () => {
    // "a bit" has no established meaning. Inventing one would be the matcher
    // deciding something the person did not say.
    for (const vague of ['go back a bit', 'skip ahead a little', 'rewind some']) {
      expect(matchPlaybackCommand(vague).matched, vague).toBe(false);
    }
  });

  it('falls through on anything outside the playback vocabulary', () => {
    for (const open of [
      'find talks about state machines',
      'queue the three shortest ones',
      'delete the duplicate',
      'what did you just do',
      'play the one about launches',
    ]) {
      expect(matchPlaybackCommand(open).matched, open).toBe(false);
    }
  });

  it('falls through on an empty or nonsense utterance', () => {
    for (const junk of ['', '   ', 'asdf', 'pause the whole internet']) {
      expect(matchPlaybackCommand(junk).matched, junk).toBe(false);
    }
  });

  it('always supplies an interpretation to show the person (FR-003)', () => {
    const r = matchPlaybackCommand('skip forward two minutes');
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.match.interpretation).toBe('Skip forward 120 seconds');
  });
});
