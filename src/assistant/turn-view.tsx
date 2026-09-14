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
    <section data-testid="assistant-turns" className="turns">
      <h2>Assistant</h2>
      <ol>
        {turns.map((t) => (
          <li key={t.commandId} className="turn" data-testid="assistant-turn" data-state={t.state} data-command-id={t.commandId}>
            <div className="turn-head">
              <strong className="turn-text">“{t.text}”</strong> — <span data-testid="turn-state" className="turn-state">{LABEL[t.state]}</span>{' '}
              {(t.state === 'acknowledged' || t.state === 'running' || t.state === 'late') && (
                <button type="button" data-testid="turn-cancel" onClick={() => onCancel(t.commandId)}>Cancel</button>
              )}
            </div>
            {t.toolCalls.length > 0 && (
              <ul className="turn-calls">
                {t.toolCalls.map((c, i) => (
                  <li key={`${c.toolName}-${String(i)}`} data-testid="turn-tool-call" className="turn-call" data-ok={c.ok === undefined ? 'pending' : String(c.ok)}>
                    {c.toolName}{c.ok === undefined ? ' …' : c.ok ? ' ✓' : ` — refused: ${c.detail ?? c.reason ?? 'no reason given'}`}
                  </li>
                ))}
              </ul>
            )}
            {t.messages.map((m, i) => <p key={String(i)} data-testid="turn-message">{m}</p>)}
            {t.refusal !== null && <p data-testid="turn-refusal" className="turn-refusal">{t.refusal.detail}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
