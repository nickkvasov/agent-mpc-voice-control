/**
 * Every tool this application declares.
 *
 * One dictionary so no tool name is ever a bare string literal, and so the
 * contract in specs/001-voice-video-control/contracts/mcp-tools.md has exactly
 * one machine-readable counterpart (IMMUNE-N).
 */
export const TOOL = {
  playbackPlay: 'playback.play',
  playbackPlayVideo: 'playback.playVideo',
  playbackPause: 'playback.pause',
  playbackStop: 'playback.stop',
  playbackSeek: 'playback.seek',
  playbackSeekToChapter: 'playback.seekToChapter',
  playbackSetRate: 'playback.setRate',
  playbackSetVolume: 'playback.setVolume',
  playbackSetMuted: 'playback.setMuted',
  playbackSetCaptions: 'playback.setCaptions',
  playbackNext: 'playback.next',
  playbackPrevious: 'playback.previous',
  playbackGetState: 'playback.getState',

  catalogSearch: 'catalog.search',
  catalogNarrow: 'catalog.narrow',
  catalogGetCurrentResults: 'catalog.getCurrentResults',
  catalogResolveReference: 'catalog.resolveReference',
  catalogGetQuota: 'catalog.getQuota',

  queueAdd: 'queue.add',
  queueRemove: 'queue.remove',
  queueReorder: 'queue.reorder',
  queueClear: 'queue.clear',
  queueGet: 'queue.get',

  curationCreateCollection: 'curation.createCollection',
  curationAddToCollection: 'curation.addToCollection',
  curationRemoveFromCollection: 'curation.removeFromCollection',
  curationDeleteCollection: 'curation.deleteCollection',
  curationSetLabel: 'curation.setLabel',
  curationAddTags: 'curation.addTags',
  curationRemoveTags: 'curation.removeTags',

  activityList: 'activity.list',
  activityUndo: 'activity.undo',
  activityDescribeRecent: 'activity.describeRecent',
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

const MEMBERS: ReadonlySet<string> = new Set(Object.values(TOOL));

export function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && MEMBERS.has(value);
}

/**
 * Tools that discard curation the person created. These declare
 * `confirmation: 'required'` and must name their target before running
 * (FR-026, Constitution VI).
 */
export const DISCARDING_TOOLS: ReadonlySet<ToolName> = new Set([
  TOOL.curationRemoveFromCollection,
  TOOL.curationDeleteCollection,
  TOOL.queueClear,
]);

/** Above this many references, an action must state the count and confirm it (FR-027). */
export const BULK_THRESHOLD = 5;
