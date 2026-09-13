import type { TurnView } from './turn-client.ts';

/**
 * What the assistant is doing, as it does it (T133, research R9).
 *
 * Acknowledged at once, running, late after ten seconds, then done, refused or
 * cancelled — never a silent spinner. A turn that has not finished can always
 * be cancelled (FR-004).
 */
const LABEL: Readonly<Record<TurnView['state'], string>> = {
  acknowledged: 'Asking the assistant…',
  running: 'The assistant is working…',
  late: 'Still working — this is taking longer than usual.',
  done: 'Done.',
  refused: 'Refused.',
  cancelled: 'Cancelled.',
};

export function TurnView({ turns, onCancel }: { turns: readonly TurnView[]; onCancel: (commandId: string) => void }) {
  if (turns.length === 0) return null;
  return (
    <section data-testid="assistant-turns" style={{ margin: '0.5rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>Assistant</h2>
      <ol>
        {turns.map((t) => (
          <li key={t.commandId} data-testid="assistant-turn" data-state={t.state} data-command-id={t.commandId}>
            <strong>“{t.text}”</strong> — <span data-testid="turn-state">{LABEL[t.state]}</span>{' '}
            {(t.state === 'acknowledged' || t.state === 'running' || t.state === 'late') && (
              <button type="button" data-testid="turn-cancel" onClick={() => onCancel(t.commandId)}>Cancel</button>
            )}
            {t.toolCalls.length > 0 && (
              <ul>
                {t.toolCalls.map((c, i) => (
                  <li key={`${c.toolName}-${String(i)}`} data-testid="turn-tool-call">
                    {c.toolName}{c.ok === undefined ? ' …' : c.ok ? ' ✓' : ` — refused: ${c.detail ?? c.reason ?? 'no reason given'}`}
                  </li>
                ))}
              </ul>
            )}
            {t.messages.map((m, i) => <p key={String(i)} data-testid="turn-message">{m}</p>)}
            {t.refusal !== null && <p data-testid="turn-refusal" style={{ color: '#a00' }}>{t.refusal.detail}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
