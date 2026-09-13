import type { McpConnectionState } from 'agent-mcp-react';
import type { TurnRefusal } from '../assistant/turn-client.ts';
/**
 * FR-037 / SC-010: with the assistant unavailable, every task remains
 * completable by hand, and its unavailability is SHOWN.
 *
 * The interface must not merely stop working conversationally — a person who
 * cannot tell the difference between "the assistant is thinking" and "the
 * assistant is gone" will wait for something that is never coming.
 */
export type ConnectionState = 'connecting' | 'connected' | 'unavailable';

/**
 * What the page says about the assistant, from what is actually true (T134).
 *
 * Connected only when the library's connection is; a spent allowance (FR-046)
 * makes it unavailable until its reset time even while connected, naming the
 * limit and when it clears. Every unavailable state carries a reason.
 */
export function deriveConnection(
  connection: McpConnectionState,
  allowance: TurnRefusal | null,
  now: number,
): { readonly state: ConnectionState; readonly reason: string | null } {
  if (allowance !== null && allowance.reason === 'assistant_allowance_spent' && (allowance.resetsAt ?? 0) > now) {
    const at = new Date(allowance.resetsAt ?? now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { state: 'unavailable', reason: `${allowance.detail} It is available again at ${at}.` };
  }
  switch (connection.status) {
    case 'connected':
      return { state: 'connected', reason: null };
    case 'connecting':
    case 'reconnecting':
      return { state: 'connecting', reason: null };
    case 'error':
      return { state: 'unavailable', reason: connection.error.message };
    case 'disconnected':
      return { state: 'unavailable', reason: 'The page is not connected to the assistant.' };
  }
}

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
