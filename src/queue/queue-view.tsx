import { DeclaredTools } from '../mcp/declared-tools.tsx';
import { VIEW_TOOLS } from '../mcp/tool-descriptions.ts';
import type { QueueState } from './queue.ts';

/** FR-020: the queue is visible whenever it changes. */
export function QueueView({
  queue,
  onRemoveEntry,
}: {
  readonly queue: QueueState;
  /**
   * By entryId, not position. The same video may be queued twice, and a button
   * bound to an index removes whatever has since moved into that slot.
   */
  readonly onRemoveEntry: (entryId: string) => void;
}) {
  return (
    <section data-testid="queue" style={{ margin: '0.5rem 0' }}>
      {/* This view's tools exist exactly while it is on screen (FR-035, Principle II). */}
      <DeclaredTools tools={VIEW_TOOLS.queue} />
      <h2 style={{ fontSize: '1rem' }}>Queue ({queue.items.length})</h2>
      {queue.items.length === 0 ? (
        <p data-testid="queue-empty">Nothing queued.</p>
      ) : (
        <ol data-testid="queue-list">
          {queue.items.map((entry) => (
            <li key={entry.entryId} data-testid="queue-item">
              {entry.videoId}{' '}
              <button type="button" onClick={() => onRemoveEntry(entry.entryId)}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
