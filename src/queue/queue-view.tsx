import type { QueueState } from './queue.ts';

/** FR-020: the queue is visible whenever it changes. */
export function QueueView({
  queue,
  onRemoveAt,
}: {
  readonly queue: QueueState;
  /** By POSITION: the same video may be queued twice, and removing one must not take both. */
  readonly onRemoveAt: (index: number) => void;
}) {
  return (
    <section data-testid="queue" style={{ margin: '0.5rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>Queue ({queue.items.length})</h2>
      {queue.items.length === 0 ? (
        <p data-testid="queue-empty">Nothing queued.</p>
      ) : (
        <ol data-testid="queue-list">
          {queue.items.map((id, i) => (
            <li key={`${id}-${String(i)}`} data-testid="queue-item">
              {id} <button type="button" onClick={() => onRemoveAt(i)}>Remove</button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
