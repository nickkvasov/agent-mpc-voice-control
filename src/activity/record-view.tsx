import { undoLabel, type DescribableEntry } from './describe.ts';
import { eligibility } from './supersession.ts';

/**
 * The activity record.
 *
 * FR-029: in the interface's own vocabulary. FR-044: where an entry cannot be
 * undone, the reason is shown and **no button is rendered** — an undo offered
 * and then refused is worse than one never offered, because the person has
 * already decided it would work.
 */
export interface RecordViewProps {
  readonly entries: readonly DescribableEntry[];
  readonly onUndo: (entryId: string) => void;
}

export function RecordView({ entries, onUndo }: RecordViewProps) {
  const ordered = [...entries].sort((a, b) => b.sequence - a.sequence);
  return (
    <section data-testid="activity" style={{ margin: '0.5rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>What the assistant did ({entries.length})</h2>
      {ordered.length === 0 ? (
        <p data-testid="activity-empty">Nothing yet.</p>
      ) : (
        <ol data-testid="activity-list" style={{ paddingLeft: '1.2rem' }}>
          {ordered.map((e) => {
            const state = eligibility(e, entries).state;
            return (
              <li key={e.entryId} data-testid="activity-entry" style={{ marginBottom: '0.4rem' }}>
                <div data-testid="activity-description">
                  {e.description}
                  {e.result === 'failed' ? ' — refused' : e.result === 'partially_applied' ? ' — partly applied' : ''}
                  {e.undone ? ' — since undone' : ''}
                </div>
                {e.failureDetail !== null && (
                  <div data-testid="activity-detail" style={{ fontSize: '0.85rem', color: '#a00' }}>
                    {e.failureDetail}
                  </div>
                )}
                <div data-testid="activity-undo" style={{ fontSize: '0.85rem', color: '#555' }}>
                  {state === 'undoable' ? (
                    <button type="button" data-testid="undo-button" onClick={() => onUndo(e.entryId)}>
                      Undo
                    </button>
                  ) : (
                    undoLabel(e, entries)
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
