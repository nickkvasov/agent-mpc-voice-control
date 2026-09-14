import { DeclaredTools } from '../mcp/declared-tools.tsx';
import { VIEW_TOOLS } from '../mcp/tool-descriptions.ts';
import type { QueueState } from './queue.ts';

/** FR-020: the queue is visible whenever it changes. */
export function QueueView({
  queue,
  titleOf,
  onRemoveEntry,
}: {
  readonly queue: QueueState;
  /** The name the rest of the page uses for a video — its label or title — or null when unknown. */
  readonly titleOf: (videoId: string) => string | null;
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
              {/* A bare id named nothing a person could recognise (demo recording, take 1). */}
              {titleOf(entry.videoId) ?? entry.videoId}{' '}
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
