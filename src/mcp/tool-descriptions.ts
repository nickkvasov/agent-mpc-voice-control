import { BULK_THRESHOLD, TOOL, type ToolName } from '../vocab/tool-names.ts';

/**
 * What the assistant is told each tool does, from contracts/mcp-tools.md.
 *
 * Written for the model, in the interface's vocabulary. The page-specific
 * guidance belongs here and in the schemas — not in the agent's system prompt,
 * which stays page-agnostic (the reference gateway's own lesson, research R6).
 */
export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  [TOOL.playbackPlay]: 'Start or resume playback of the loaded video. Refuses when nothing is loaded.',
  [TOOL.playbackPlayVideo]: 'Load a video by its id and play it. Reports what the player confirmed: playing, blocked by the browser, or the specific reason the video cannot play.',
  [TOOL.playbackPause]: 'Pause playback. Refuses, saying so, when nothing is playing.',
  [TOOL.playbackStop]: 'Stop playback.',
  [TOOL.playbackSeek]: 'Seek to an absolute position, or by a relative number of seconds (negative goes back). Reports the position actually reached, which may be clamped.',
  [TOOL.playbackSeekToChapter]: 'Jump to the chapter whose title best matches the query. Refuses when the video publishes no chapters or it is not yet known whether it does.',
  [TOOL.playbackSetRate]: 'Change playback speed. Reports the rate actually in effect, which may differ from the one asked for.',
  [TOOL.playbackSetVolume]: 'Set volume from 0 to 100. Reports refusal when the platform does not allow it.',
  [TOOL.playbackSetMuted]: 'Mute or unmute.',
  [TOOL.playbackSetCaptions]: 'Turn captions on or off, optionally choosing a track by language code.',
  [TOOL.playbackNext]: 'Play the next item in the queue, skipping unavailable ones and saying why.',
  [TOOL.playbackPrevious]: 'Play the previous item in the queue.',
  [TOOL.playbackGetState]: 'Read what the player is doing now: state, position, duration, speed, volume, mute. Changes nothing.',
  [TOOL.catalogSearch]: 'Search YouTube. Spends the deployment\'s small shared daily search allowance — prefer narrowing the current results when the person is refining what is already shown.',
  [TOOL.catalogNarrow]: 'Filter the results already shown by duration, date or title. Spends no search allowance.',
  [TOOL.catalogGetCurrentResults]: 'Read the results currently shown and the criteria that produced them. Changes nothing.',
  [TOOL.catalogResolveReference]: 'Work out which shown video a phrase like "the third one" or "the shortest" means. Returns candidates rather than guessing when it is ambiguous.',
  [TOOL.catalogGetQuota]: 'Read how much search allowance is left today, which may be unknown. Changes nothing.',
  [TOOL.queueAdd]: `Add videos to the queue, next or at the end. More than ${String(BULK_THRESHOLD)} asks the person to confirm the count.`,
  [TOOL.queueRemove]: 'Remove videos from the queue.',
  [TOOL.queueReorder]: 'Move a queued video to a new position.',
  [TOOL.queueClear]: `Clear the queue. More than ${String(BULK_THRESHOLD)} items asks the person to confirm the count.`,
  [TOOL.queueGet]: 'Read the queue. Changes nothing.',
  [TOOL.curationCreateCollection]: 'Create a named collection. A duplicate name is refused.',
  [TOOL.curationAddToCollection]: 'Add videos to a collection.',
  [TOOL.curationRemoveFromCollection]: 'Remove videos from a collection. The person is asked to confirm, naming the videos and the collection.',
  [TOOL.curationDeleteCollection]: 'Delete a collection. The person must confirm by stating how many videos it holds.',
  [TOOL.curationSetLabel]: 'Give a video a personal label shown in place of its title here. The YouTube title is never changed. Null clears it.',
  [TOOL.curationAddTags]: 'Add tags to videos.',
  [TOOL.curationRemoveTags]: 'Remove tags from videos.',
  [TOOL.activityList]: 'Read the activity record: every action taken, including refusals. Changes nothing.',
  [TOOL.activityUndo]: 'Undo a reversible entry in the activity record, not only the most recent. Refuses, naming the later entry, when it can no longer be undone.',
  [TOOL.activityDescribeRecent]: 'Describe what was done recently, straight from the activity record. Use this to answer "what did you just do?".',
};

/** Which tools each view declares. A view off screen declares none of them (FR-035). */
export const VIEW_TOOLS = {
  player: [
    TOOL.playbackPlay, TOOL.playbackPlayVideo, TOOL.playbackPause, TOOL.playbackStop, TOOL.playbackSeek, TOOL.playbackSeekToChapter,
    TOOL.playbackSetRate, TOOL.playbackSetVolume, TOOL.playbackSetMuted, TOOL.playbackSetCaptions,
    TOOL.playbackNext, TOOL.playbackPrevious, TOOL.playbackGetState,
  ],
  results: [TOOL.catalogSearch, TOOL.catalogNarrow, TOOL.catalogGetCurrentResults, TOOL.catalogResolveReference, TOOL.catalogGetQuota],
  queue: [TOOL.queueAdd, TOOL.queueRemove, TOOL.queueReorder, TOOL.queueClear, TOOL.queueGet],
  curation: [
    TOOL.curationCreateCollection, TOOL.curationAddToCollection, TOOL.curationRemoveFromCollection,
    TOOL.curationDeleteCollection, TOOL.curationSetLabel, TOOL.curationAddTags, TOOL.curationRemoveTags,
  ],
  activity: [TOOL.activityList, TOOL.activityUndo, TOOL.activityDescribeRecent],
} as const satisfies Readonly<Record<string, readonly ToolName[]>>;

/**
 * A tool named in the interface's own words, for the activity record (FR-029):
 * the first sentence of its description. A raw id like `queue.clear` in the
 * record is vocabulary the person never sees anywhere else.
 */
export function toolLabel(tool: ToolName): string {
  const first = TOOL_DESCRIPTIONS[tool].split('. ')[0] ?? tool;
  return first.replace(/\.$/, '');
}

