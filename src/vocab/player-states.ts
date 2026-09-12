/**
 * Player states, mirroring the IFrame Player API's numeric model.
 *
 * The numbers are the external vocabulary; this module is the only place they
 * are written down, so nothing else in the codebase compares against a literal.
 */
export const PLAYER_STATE = {
  unstarted: 'unstarted',
  ended: 'ended',
  playing: 'playing',
  paused: 'paused',
  buffering: 'buffering',
  cued: 'cued',
} as const;

export type PlayerState = (typeof PLAYER_STATE)[keyof typeof PLAYER_STATE];

const FROM_CODE: Readonly<Record<number, PlayerState>> = {
  [-1]: PLAYER_STATE.unstarted,
  0: PLAYER_STATE.ended,
  1: PLAYER_STATE.playing,
  2: PLAYER_STATE.paused,
  3: PLAYER_STATE.buffering,
  5: PLAYER_STATE.cued,
};

/**
 * Returns `undefined` for a code the API has never documented rather than
 * guessing a neighbour — an unknown state must stay visible (IMMUNE-U).
 */
export function playerStateFromCode(code: number): PlayerState | undefined {
  return FROM_CODE[code];
}
