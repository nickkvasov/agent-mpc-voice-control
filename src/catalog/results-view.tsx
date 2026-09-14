import { AVAILABILITY, type Availability } from '../vocab/availability.ts';
import { DeclaredTools } from '../mcp/declared-tools.tsx';
import { VIEW_TOOLS } from '../mcp/tool-descriptions.ts';
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

const AVAILABILITY_LABEL: Readonly<Record<Availability, string>> = {
  [AVAILABILITY.available]: 'available',
  [AVAILABILITY.removed]: 'removed',
  [AVAILABILITY.private]: 'private',
  [AVAILABILITY.ageRestricted]: 'age-restricted',
  [AVAILABILITY.regionBlocked]: 'not available in this region',
  [AVAILABILITY.embeddingDisallowed]: 'its owner does not allow embedding',
  [AVAILABILITY.unknown]: 'not known',
};

/** Under a minute in seconds: "0 min" for an 8-second video read like the old zero-duration defect (Gate B). */
function formatDuration(seconds: number): string {
  return seconds < 60 ? `${String(Math.round(seconds))} s` : `${String(Math.round(seconds / 60))} min`;
}

export function ResultsView({ results, quota, onQueue, onPlay, onAddToCollection }: ResultsViewProps) {
  return (
    <section data-testid="results" className="panel panel-results">
      {/* This view's tools exist exactly while it is on screen (FR-035, Principle II). */}
      <DeclaredTools tools={VIEW_TOOLS.results} />
      <h2>Results</h2>
      <p data-testid="results-operation">{OPERATION_LABEL[results.operation]}{results.fromCache ? ' (from cache, no allowance spent)' : ''}</p>
      <p data-testid="results-criteria" className="quiet">Criteria: {describeCriteria(results.criteria)}</p>
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
        <ol data-testid="results-list" className="rows">
          {results.items.map((v) => (
            <li key={v.videoId} data-testid="result-item">
              {/* A bare text node, not an element: `text=Play` resolves to the smallest element holding
                  that text, and a wrapped title such as "Embedded Player" won that match over the button. */}
              {v.title}{' '}
              <small className="row-meta">
                ({isUnknown(v.durationSeconds) ? 'length not yet known' : formatDuration(v.durationSeconds as number)})
              </small>{' '}
              {v.availability !== AVAILABILITY.available && v.availability !== AVAILABILITY.unknown && (
                // FR-036: learned from the player when it refused this video — shown
                // where the person would try it again, not only in the player's status.
                <small data-testid="result-unavailable" className="warn">
                  cannot play here: {AVAILABILITY_LABEL[v.availability]}{' '}
                </small>
              )}
              <span className="row-actions">
              <button type="button" onClick={() => onPlay(v.videoId)}>Play</button>{' '}
              <button type="button" onClick={() => onQueue(v.videoId)}>Queue</button>{' '}
              <button type="button" data-testid="add-to-collection" onClick={() => onAddToCollection(v.videoId)}>
                Add to collection
              </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
