import { DeclaredTools } from '../mcp/declared-tools.tsx';
import { VIEW_TOOLS } from '../mcp/tool-descriptions.ts';
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
    <section data-testid="controls" className="controls">
      {/* This view's tools exist exactly while it is on screen (FR-035, Principle II). */}
      <DeclaredTools tools={VIEW_TOOLS.player} />
      <div className="transport">
        <button type="button" data-testid="btn-play" onClick={() => p.onCommand('play')}>Play</button>{' '}
        <button type="button" data-testid="btn-pause" onClick={() => p.onCommand('pause')}>Pause</button>{' '}
        <button type="button" data-testid="btn-back" onClick={() => p.onCommand('go back fifteen seconds')}>−15s</button>{' '}
        <button type="button" data-testid="btn-fwd" onClick={() => p.onCommand('skip forward fifteen seconds')}>+15s</button>
      </div>
      <dl className="readout">
        <div><dt>State</dt><dd data-testid="state">{p.state}</dd></div>
        <div><dt>Position</dt><dd data-testid="position">{Math.round(p.positionSeconds)}s / {Math.round(p.durationSeconds)}s</dd></div>
        <div><dt>Speed</dt><dd data-testid="rate">{p.rate}x</dd></div>
        <div><dt>Volume</dt><dd data-testid="volume">{p.muted ? 'muted' : p.volume}</dd></div>
        <div><dt>Captions</dt><dd data-testid="captions">{p.captionsTrack ?? 'off (unconfirmed)'}</dd></div>
      </dl>

    </section>
  );
}
