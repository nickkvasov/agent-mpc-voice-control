import type { Collection } from './collections.ts';
import { displayName } from './annotations.ts';
import type { VideoReference } from '../store/video-reference.ts';

/**
 * FR-025 made visible: the interface shows which text is the person's own and
 * which belongs to the video at its source. A label that looked like a title
 * would quietly suggest this app had renamed something on YouTube.
 */
export interface CurationViewProps {
  readonly collections: readonly Collection[];
  readonly videos: readonly VideoReference[];
  readonly onCreate: (name: string) => void;
  readonly onDelete: (collectionId: string) => void;
}

export function CurationView({ collections, videos, onCreate, onDelete }: CurationViewProps) {
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  return (
    <section data-testid="curation" style={{ margin: '0.5rem 0' }}>
      <h2 style={{ fontSize: '1rem' }}>Collections ({collections.length})</h2>
      <form
        data-testid="collection-form"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          if (typeof name === 'string' && name.trim() !== '') onCreate(name);
          e.currentTarget.reset();
        }}
      >
        <label>
          New collection <input name="name" data-testid="collection-name" placeholder="Favourites" />
        </label>{' '}
        <button type="submit" data-testid="collection-create">Create</button>
      </form>
      {collections.length === 0 ? (
        <p data-testid="collections-empty">No collections yet.</p>
      ) : (
        <ul data-testid="collections-list">
          {collections.map((c) => (
            <li key={c.collectionId} data-testid="collection-item">
              <strong>{c.name}</strong> ({c.videoIds.length}){' '}
              <button type="button" data-testid="collection-delete" onClick={() => onDelete(c.collectionId)}>
                Delete
              </button>
              <ul>
                {c.videoIds.map((id) => {
                  const v = byId.get(id);
                  if (v === undefined) return <li key={id}>{id}</li>;
                  const shown = displayName(v);
                  return (
                    <li key={id} data-testid="collection-video">
                      {shown.shown}{' '}
                      {shown.isPersonal && (
                        <small data-testid="personal-label" style={{ color: '#555' }}>
                          (your label — the video is still called &ldquo;{v.title}&rdquo; on YouTube)
                        </small>
                      )}
                      {v.tags.length > 0 && (
                        <small data-testid="video-tags" style={{ color: '#555' }}> · your tags: {v.tags.join(', ')}</small>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
