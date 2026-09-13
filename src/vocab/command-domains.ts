import { TOOL, type ToolName } from './tool-names.ts';

/**
 * The domains commands are ordered within (FR-038, research R7).
 *
 * Order is kept inside a domain and never across: a pause cannot conflict with
 * a search, so it must not wait for one. One closed set, per the named
 * vocabularies rule.
 */
export const DOMAIN = {
  playback: 'playback',
  queue: 'queue',
  catalogCuration: 'catalog_curation',
} as const;

export type CommandDomain = (typeof DOMAIN)[keyof typeof DOMAIN];

/**
 * `activity.undo` has no domains of its own: it is fenced by the domains of the
 * entry it reverses, which only the entry knows.
 */
export const PER_ENTRY = 'per_entry' as const;

type Declared = readonly CommandDomain[] | typeof PER_ENTRY;

const P = [DOMAIN.playback] as const;
const Q = [DOMAIN.queue] as const;
const C = [DOMAIN.catalogCuration] as const;
const NONE = [] as const;

/**
 * Every tool's declared domains. A `Record` over `ToolName`, so adding a tool
 * without deciding its domains does not compile.
 *
 * `playback.next`/`previous` declare the queue too: they advance it, and a
 * playback-only label would let them bypass the queue's order (codex, R7).
 * Read-only tools touch nothing and are never refused as overtaken.
 */
export const TOOL_DOMAINS: Readonly<Record<ToolName, Declared>> = {
  [TOOL.playbackPlay]: P,
  [TOOL.playbackPause]: P,
  [TOOL.playbackStop]: P,
  [TOOL.playbackSeek]: P,
  [TOOL.playbackSeekToChapter]: P,
  [TOOL.playbackSetRate]: P,
  [TOOL.playbackSetVolume]: P,
  [TOOL.playbackSetMuted]: P,
  [TOOL.playbackSetCaptions]: P,
  [TOOL.playbackNext]: [DOMAIN.playback, DOMAIN.queue],
  [TOOL.playbackPrevious]: [DOMAIN.playback, DOMAIN.queue],
  [TOOL.playbackGetState]: NONE,

  [TOOL.catalogSearch]: C,
  [TOOL.catalogNarrow]: C,
  [TOOL.catalogGetCurrentResults]: NONE,
  [TOOL.catalogResolveReference]: NONE,
  [TOOL.catalogGetQuota]: NONE,

  [TOOL.queueAdd]: Q,
  [TOOL.queueRemove]: Q,
  [TOOL.queueReorder]: Q,
  [TOOL.queueClear]: Q,
  [TOOL.queueGet]: NONE,

  [TOOL.curationCreateCollection]: C,
  [TOOL.curationAddToCollection]: C,
  [TOOL.curationRemoveFromCollection]: C,
  [TOOL.curationDeleteCollection]: C,
  [TOOL.curationSetLabel]: C,
  [TOOL.curationAddTags]: C,
  [TOOL.curationRemoveTags]: C,

  [TOOL.activityList]: NONE,
  [TOOL.activityUndo]: PER_ENTRY,
  [TOOL.activityDescribeRecent]: NONE,
};

/** Tools that change nothing. The only ones allowed an empty domain set. */
export const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set([
  TOOL.playbackGetState,
  TOOL.catalogGetCurrentResults,
  TOOL.catalogResolveReference,
  TOOL.catalogGetQuota,
  TOOL.queueGet,
  TOOL.activityList,
  TOOL.activityDescribeRecent,
]);

export class UndeclaredDomain extends Error {}

/**
 * The domains a call must hold. Throws — at declaration time, where it is
 * called — for a mutating tool that declares none, because an undeclared tool
 * would bypass FR-038 without anything appearing wrong.
 */
export function domainsOf(tool: ToolName, entryDomains?: readonly CommandDomain[]): readonly CommandDomain[] {
  const declared = TOOL_DOMAINS[tool];
  if (declared === PER_ENTRY) {
    if (entryDomains === undefined) {
      throw new UndeclaredDomain(`${tool} is fenced by the entry it acts on, and no entry domains were given`);
    }
    return entryDomains;
  }
  if (declared.length === 0 && !READ_ONLY_TOOLS.has(tool)) {
    throw new UndeclaredDomain(`${tool} changes state but declares no domain`);
  }
  return declared;
}
