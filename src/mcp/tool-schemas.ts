import { TOOL, type ToolName } from '../vocab/tool-names.ts';
import { BULK_THRESHOLD } from '../vocab/tool-names.ts';

/**
 * Input schemas for every tool, written from contracts/mcp-tools.md — the
 * business fields only. The reserved `commandId` is added by `command-id.ts`,
 * never here, so there is one place it is defined (research R7, IMMUNE-N).
 *
 * The validator `agent-mcp-react` requires enforces these before a handler
 * runs; every one sets `additionalProperties: false` and lists `required`.
 */
// A type alias, not an interface: an interface has no implicit index signature,
// and `useMcpTool` takes a `Record<string, unknown>`.
export type ObjectSchema = {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

const obj = (properties: Record<string, unknown> = {}, required: readonly string[] = []): ObjectSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const videoId = { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' };
const videoIds = { type: 'array', items: videoId, minItems: 1, uniqueItems: true };
const nonEmpty = { type: 'string', minLength: 1 };
const timestamp = { type: 'number', minimum: 0 };

export const BUSINESS_SCHEMAS: Readonly<Record<ToolName, ObjectSchema>> = {
  [TOOL.playbackPlay]: obj(),
  [TOOL.playbackPlayVideo]: obj({ videoId }, ['videoId']),
  [TOOL.playbackPause]: obj(),
  [TOOL.playbackStop]: obj(),
  [TOOL.playbackSeek]: obj({ mode: { enum: ['absolute', 'relative'] }, seconds: { type: 'number' } }, ['mode', 'seconds']),
  [TOOL.playbackSeekToChapter]: obj({ query: nonEmpty }, ['query']),
  [TOOL.playbackSetRate]: obj({ rate: { type: 'number', exclusiveMinimum: 0, maximum: 4 } }, ['rate']),
  [TOOL.playbackSetVolume]: obj({ volume: { type: 'integer', minimum: 0, maximum: 100 } }, ['volume']),
  [TOOL.playbackSetMuted]: obj({ muted: { type: 'boolean' } }, ['muted']),
  [TOOL.playbackSetCaptions]: obj({ enabled: { type: 'boolean' }, track: nonEmpty }, ['enabled']),
  [TOOL.playbackNext]: obj(),
  [TOOL.playbackPrevious]: obj(),
  [TOOL.playbackGetState]: obj(),

  // No `maxResults`: the contract listed it, but neither the page's client nor
  // the backend honours it, and accepting an input that is silently ignored is
  // the bare success Constitution III forbids. Add it back with its plumbing.
  [TOOL.catalogSearch]: obj({ query: nonEmpty, publishedAfter: timestamp, publishedBefore: timestamp }, ['query']),
  [TOOL.catalogNarrow]: obj({
    maxDurationSeconds: { type: 'number', minimum: 0 },
    minDurationSeconds: { type: 'number', minimum: 0 },
    publishedAfter: timestamp,
    publishedBefore: timestamp,
    titleContains: nonEmpty,
  }),
  [TOOL.catalogGetCurrentResults]: obj(),
  [TOOL.catalogResolveReference]: obj({ reference: nonEmpty }, ['reference']),
  [TOOL.catalogGetQuota]: obj(),

  [TOOL.queueAdd]: obj({ videoIds, position: { enum: ['next', 'end'] } }, ['videoIds']),
  // By video removes every occurrence; by entry removes exactly one — the queue
  // may hold a video twice, and the queue view's Remove button means that one.
  // "Exactly one of videoIds or entryIds" is enforced by the action, not here:
  // property counts would count the reserved commandId, and a top-level oneOf is
  // refused by the Claude API — which failed every assistant turn (Phase 12 Gate B).
  [TOOL.queueRemove]: obj({ videoIds, entryIds: { type: 'array', items: nonEmpty, minItems: 1, uniqueItems: true } }),
  [TOOL.queueReorder]: obj({ videoId, toIndex: { type: 'integer', minimum: 0 } }, ['videoId', 'toIndex']),
  [TOOL.queueClear]: obj(),
  [TOOL.queueGet]: obj(),

  [TOOL.curationCreateCollection]: obj({ name: nonEmpty }, ['name']),
  [TOOL.curationAddToCollection]: obj({ collectionId: nonEmpty, videoIds }, ['collectionId', 'videoIds']),
  [TOOL.curationRemoveFromCollection]: obj({ collectionId: nonEmpty, videoIds }, ['collectionId', 'videoIds']),
  [TOOL.curationDeleteCollection]: obj({ collectionId: nonEmpty }, ['collectionId']),
  [TOOL.curationSetLabel]: obj({ videoId, label: { type: ['string', 'null'] } }, ['videoId', 'label']),
  [TOOL.curationAddTags]: obj({ videoIds, tags: { type: 'array', items: nonEmpty, minItems: 1 } }, ['videoIds', 'tags']),
  [TOOL.curationRemoveTags]: obj({ videoIds, tags: { type: 'array', items: nonEmpty, minItems: 1 } }, ['videoIds', 'tags']),
  [TOOL.curationGetCollections]: obj(),

  [TOOL.activityList]: obj({ limit: { type: 'integer', minimum: 1, maximum: 200 } }),
  [TOOL.activityUndo]: obj({ entryId: nonEmpty }, ['entryId']),
  [TOOL.activityDescribeRecent]: obj({ count: { type: 'integer', minimum: 1, maximum: 20 } }),
};

/** Re-exported so a schema reviewer sees the threshold the descriptions promise. */
export { BULK_THRESHOLD };
