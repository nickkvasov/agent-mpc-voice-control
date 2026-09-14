import { DeclaredTools } from '../mcp/declared-tools.tsx';
import { VIEW_TOOLS } from '../mcp/tool-descriptions.ts';
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
  readonly onRemoveVideo: (collectionId: string, videoId: string) => void;
  readonly onLabel: (videoId: string) => void;
  readonly onTag: (videoId: string) => void;
  /** null while unknown; false means nothing here survives a reload. */
  readonly storageDurable: boolean | null;
  readonly destination: string | null;
  readonly onChooseDestination: (collectionId: string) => void;
}

export function CurationView({
  collections, videos, onCreate, onDelete, onRemoveVideo, onLabel, onTag, storageDurable,
  destination, onChooseDestination,
}: CurationViewProps) {
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  return (
    <section data-testid="curation" className="panel">
      {/* This view's tools exist exactly while it is on screen (FR-035, Principle II). */}
      <DeclaredTools tools={VIEW_TOOLS.curation} />
      <h2>Collections ({collections.length})</h2>
      {storageDurable === false && (
        <p data-testid="storage-warning" className="quiet warn">
          Storage is unavailable in this browser, so collections will NOT survive a reload.
        </p>
      )}
      <form
        data-testid="collection-form"
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const name = new FormData(e.currentTarget).get('name');
          if (typeof name === 'string' && name.trim() !== '') onCreate(name);
          e.currentTarget.reset();
        }}
      >
        <label className="field">
          <span>New collection</span> <input name="name" data-testid="collection-name" placeholder="Favourites" />
        </label>{' '}
        <button type="submit" data-testid="collection-create">Create</button>
      </form>
      {collections.length > 1 && (
        <label className="field">
          <span>Add videos to</span>{' '}
          <select
            data-testid="destination"
            value={destination ?? ''}
            onChange={(e) => onChooseDestination(e.target.value)}
          >
            {collections.map((c) => (
              <option key={c.collectionId} value={c.collectionId}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      {collections.length === 0 ? (
        <p data-testid="collections-empty">No collections yet.</p>
      ) : (
        <ul data-testid="collections-list" className="rows">
          {collections.map((c) => (
            <li key={c.collectionId} data-testid="collection-item" className="collection">
              <strong className="row-title">{c.name}</strong> <span className="row-meta">({c.videoIds.length})</span>{' '}
              <button type="button" data-testid="collection-delete" onClick={() => onDelete(c.collectionId)}>
                Delete
              </button>
              <ul className="rows collection-videos">
                {c.videoIds.map((id) => {
                  const v = byId.get(id);
                  // A member not in the CURRENT results — after a reload, a new
                  // search, or a narrowing — still needs its Remove control,
                  // which needs no metadata at all (Gate C).
                  if (v === undefined) {
                    return (
                      <li key={id} data-testid="collection-video">
                        <span className="row-title">{id} <small className="row-meta">(details not loaded)</small></span>{' '}
                        <button
                          type="button"
                          data-testid="remove-from-collection"
                          onClick={() => onRemoveVideo(c.collectionId, id)}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  }
                  const shown = displayName(v);
                  return (
                    <li key={id} data-testid="collection-video">
                      <span className="row-title">
                      {shown.shown}{' '}
                      {shown.isPersonal && (
                        <small data-testid="personal-label" className="row-meta">
                          (your label — the video is still called &ldquo;{v.title}&rdquo; on YouTube)
                        </small>
                      )}
                      {v.tags.length > 0 && (
                        <small data-testid="video-tags" className="row-meta"> · your tags: {v.tags.join(', ')}</small>
                      )}
                      </span>{' '}
                      <span className="row-actions">
                      <button type="button" data-testid="label-video" onClick={() => onLabel(id)}>Label</button>{' '}
                      <button type="button" data-testid="tag-video" onClick={() => onTag(id)}>Tag</button>{' '}
                      <button
                        type="button"
                        data-testid="remove-from-collection"
                        onClick={() => onRemoveVideo(c.collectionId, id)}
                      >
                        Remove
                      </button>
                      </span>
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
