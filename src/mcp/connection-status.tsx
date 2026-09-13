/**
 * FR-037 / SC-010: with the assistant unavailable, every task remains
 * completable by hand, and its unavailability is SHOWN.
 *
 * The interface must not merely stop working conversationally — a person who
 * cannot tell the difference between "the assistant is thinking" and "the
 * assistant is gone" will wait for something that is never coming.
 */
export type ConnectionState = 'connecting' | 'connected' | 'unavailable';

export interface ConnectionStatusProps {
  readonly state: ConnectionState;
  /** Required when unavailable: a state with no reason is not explainable. */
  readonly reason: string | null;
}

export function ConnectionStatus({ state, reason }: ConnectionStatusProps) {
  const label =
    state === 'connected'
      ? 'Assistant connected.'
      : state === 'connecting'
        ? 'Connecting to the assistant…'
        : 'Assistant unavailable.';
  return (
    <p
      data-testid="connection-status"
      data-state={state}
      style={{ fontSize: '0.85rem', color: state === 'unavailable' ? '#a00' : '#555' }}
    >
      {label}
      {state === 'unavailable' && (
        <>
          {' '}
          <span data-testid="connection-reason">{reason ?? 'No reason was reported, which is itself a fault.'}</span>{' '}
          <span data-testid="hand-path">Everything here still works by hand.</span>
        </>
      )}
    </p>
  );
}
