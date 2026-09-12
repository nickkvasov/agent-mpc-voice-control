import { TOOL, type ToolName } from '../vocab/tool-names.ts';

/**
 * The local deterministic matcher (research.md R3).
 *
 * SC-001 requires a visible result within one second of the person finishing
 * speaking. A remote model round-trip cannot meet that, and a spoken "pause"
 * that takes two seconds stops feeling like a control. The playback vocabulary
 * is closed and finite, which is exactly where a matcher belongs.
 *
 * **It never guesses.** An utterance it does not match with confidence falls
 * through to the agent rather than picking a nearest command — the two paths
 * must never interpret the same utterance, which is what keeps the tools the
 * single owner of meaning (IMMUNE-N, and the Complexity Tracking entry in
 * plan.md).
 */
export interface Match {
  readonly tool: ToolName;
  readonly input: Record<string, unknown>;
  /** What the person will be shown as the system's reading of their words (FR-003). */
  readonly interpretation: string;
}

export type MatchOutcome = { readonly matched: true; readonly match: Match } | { readonly matched: false };

const NO_MATCH: MatchOutcome = { matched: false };

const UNITS: Readonly<Record<string, number>> = { second: 1, seconds: 1, sec: 1, secs: 1, minute: 60, minutes: 60, min: 60, mins: 60, hour: 3600, hours: 3600 };

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
};

export function matchPlaybackCommand(utterance: string): MatchOutcome {
  // Strip sentence punctuation, but NOT a decimal point: "speed 1.5" became
  // "speed 15" and applied 2x. Found by driving it at Gate B — the unit test
  // asserted which tool matched and never the value it carried, so it passed.
  const t = utterance
    .trim()
    .toLowerCase()
    .replace(/[!?,]/g, '')
    .replace(/\.(?!\d)/g, '');
  if (t === '') return NO_MATCH;

  const exact: Readonly<Record<string, Match>> = {
    pause: { tool: TOOL.playbackPause, input: {}, interpretation: 'Pause playback' },
    'pause it': { tool: TOOL.playbackPause, input: {}, interpretation: 'Pause playback' },
    stop: { tool: TOOL.playbackStop, input: {}, interpretation: 'Stop playback' },
    play: { tool: TOOL.playbackPlay, input: {}, interpretation: 'Start playback' },
    resume: { tool: TOOL.playbackPlay, input: {}, interpretation: 'Resume playback' },
    'keep going': { tool: TOOL.playbackPlay, input: {}, interpretation: 'Resume playback' },
    next: { tool: TOOL.playbackNext, input: {}, interpretation: 'Play the next item in the queue' },
    'next one': { tool: TOOL.playbackNext, input: {}, interpretation: 'Play the next item in the queue' },
    previous: { tool: TOOL.playbackPrevious, input: {}, interpretation: 'Play the previous item' },
    'go back one': { tool: TOOL.playbackPrevious, input: {}, interpretation: 'Play the previous item' },
    mute: { tool: TOOL.playbackSetMuted, input: { muted: true }, interpretation: 'Mute audio' },
    unmute: { tool: TOOL.playbackSetMuted, input: { muted: false }, interpretation: 'Unmute audio' },
  };
  const hit = exact[t];
  if (hit !== undefined) return { matched: true, match: hit };

  const captions = /^(turn |switch )?(on|off|enable|disable) (the )?(captions|subtitles)$|^(captions|subtitles) (on|off)$/.exec(t);
  if (captions !== null) {
    const enabled = /\b(on|enable)\b/.test(t);
    return {
      matched: true,
      match: {
        tool: TOOL.playbackSetCaptions,
        input: { enabled },
        interpretation: `Turn captions ${enabled ? 'on' : 'off'}`,
      },
    };
  }

  const rate = /^(?:set )?(?:the )?(?:playback )?speed (?:to )?([\d.]+)x?$|^([\d.]+)x speed$/.exec(t);
  if (rate !== null) {
    const value = Number(rate[1] ?? rate[2]);
    if (Number.isFinite(value) && value > 0) {
      return { matched: true, match: { tool: TOOL.playbackSetRate, input: { rate: value }, interpretation: `Set playback speed to ${String(value)}x` } };
    }
  }

  const seek = /^(skip|jump|go|scrub)?\s*(forward|forwards|ahead|back|backward|backwards)\s*(?:by\s*)?([a-z0-9.]+)?\s*(seconds?|secs?|minutes?|mins?|hours?)?$/.exec(t);
  if (seek !== null && seek[2] !== undefined) {
    const amountWord = seek[3];
    const unit = seek[4];
    // "go back a bit" has no established meaning. The matcher does NOT invent
    // one; it declines so the agent can ask (FR-034, edge case in spec.md).
    if (amountWord === undefined || unit === undefined) return NO_MATCH;
    const n = Number.isFinite(Number(amountWord)) ? Number(amountWord) : WORD_NUMBERS[amountWord];
    if (n === undefined || !Number.isFinite(n)) return NO_MATCH;
    const seconds = n * (UNITS[unit] ?? 1);
    const backwards = /back/.test(seek[2]);
    return {
      matched: true,
      match: {
        tool: TOOL.playbackSeek,
        input: { mode: 'relative', seconds: backwards ? -seconds : seconds },
        interpretation: `Skip ${backwards ? 'back' : 'forward'} ${String(seconds)} seconds`,
      },
    };
  }

  const volume = /^(?:set )?volume (?:to )?(\d{1,3})%?$/.exec(t);
  if (volume !== null) {
    const v = Number(volume[1]);
    if (v >= 0 && v <= 100) {
      return { matched: true, match: { tool: TOOL.playbackSetVolume, input: { volume: v }, interpretation: `Set volume to ${String(v)}` } };
    }
  }

  return NO_MATCH;
}
