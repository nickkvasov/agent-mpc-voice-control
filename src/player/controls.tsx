import type { PlayerState } from '../vocab/player-states.ts';

/**
 * FR-013: every command-driven change is reflected here within a second, so a
 * person can see that the assistant and the interface agree. FR-005: every one
 * of these is also reachable by hand.
 */
export interface ControlsProps {
  readonly state: PlayerState;
  readonly positionSeconds: number;
  readonly durationSeconds: number;
  readonly rate: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly captionsTrack: string | null;
  readonly onCommand: (text: string) => void;
}

export function Controls(p: ControlsProps) {
  return (
    <section data-testid="controls" style={{ margin: '0.5rem 0' }}>
      <div>
        <button type="button" data-testid="btn-play" onClick={() => p.onCommand('play')}>Play</button>{' '}
        <button type="button" data-testid="btn-pause" onClick={() => p.onCommand('pause')}>Pause</button>{' '}
        <button type="button" data-testid="btn-back" onClick={() => p.onCommand('go back fifteen seconds')}>−15s</button>{' '}
        <button type="button" data-testid="btn-fwd" onClick={() => p.onCommand('skip forward fifteen seconds')}>+15s</button>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0 0.5rem', maxWidth: '24rem' }}>
        <dt>State</dt><dd data-testid="state">{p.state}</dd>
        <dt>Position</dt><dd data-testid="position">{Math.round(p.positionSeconds)}s / {Math.round(p.durationSeconds)}s</dd>
        <dt>Speed</dt><dd data-testid="rate">{p.rate}x</dd>
        <dt>Volume</dt><dd data-testid="volume">{p.muted ? 'muted' : p.volume}</dd>
        <dt>Captions</dt><dd data-testid="captions">{p.captionsTrack ?? 'off (unconfirmed)'}</dd>
      </dl>
    </section>
  );
}
