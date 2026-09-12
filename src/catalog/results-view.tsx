import type { ResultSet } from './results.ts';
import { describeCriteria } from './results.ts';
import { isUnknown } from '../store/video-reference.ts';
import type { QuotaView } from './client.ts';
import { QuotaIndicator } from './quota-indicator.tsx';

/**
 * FR-021: the criteria applied are stated on every result set, and FR-016's
 * distinction is visible — the person can see whether this was a fresh search
 * or a narrowing of what was already there.
 */
const OPERATION_LABEL: Readonly<Record<ResultSet['operation'], string>> = {
  fresh_search: 'Started a fresh search',
  narrowed: 'Narrowed the current results',
  unchanged: 'Those criteria were already applied',
  read: 'Current results',
};

export interface ResultsViewProps {
  readonly results: ResultSet;
  readonly quota: QuotaView;
  readonly onQueue: (videoId: string) => void;
  readonly onAddToCollection: (videoId: string) => void;
  readonly onPlay: (videoId: string) => void;
}

export function ResultsView({ results, quota, onQueue, onPlay, onAddToCollection }: ResultsViewProps) {
  return (
    <section data-testid="results" style={{ margin: '0.5rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>Results</h2>
      <p data-testid="results-operation">{OPERATION_LABEL[results.operation]}{results.fromCache ? ' (from cache, no allowance spent)' : ''}</p>
      <p data-testid="results-criteria">Criteria: {describeCriteria(results.criteria)}</p>
      {results.setAsideUnknown > 0 && (
        <p data-testid="results-set-aside">
          {results.setAsideUnknown} result{results.setAsideUnknown === 1 ? '' : 's'} set aside: their length is not yet
          known, so a length filter cannot be applied to them.
        </p>
      )}
      <QuotaIndicator quota={quota} />
      {results.items.length === 0 ? (
        <p data-testid="results-empty">
          Nothing matches those criteria. That is the filter, not a failure — widen it or start a new search.
        </p>
      ) : (
        <ol data-testid="results-list">
          {results.items.map((v) => (
            <li key={v.videoId} data-testid="result-item">
              {v.title}{' '}
              <small>
                ({isUnknown(v.durationSeconds) ? 'length not yet known' : `${String(Math.round((v.durationSeconds as number) / 60))} min`})
              </small>{' '}
              <button type="button" onClick={() => onPlay(v.videoId)}>Play</button>{' '}
              <button type="button" onClick={() => onQueue(v.videoId)}>Queue</button>{' '}
              <button type="button" data-testid="add-to-collection" onClick={() => onAddToCollection(v.videoId)}>
                Add to collection
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
