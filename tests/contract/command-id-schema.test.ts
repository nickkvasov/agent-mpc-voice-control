import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { TOOL, type ToolName } from '../../src/vocab/tool-names.ts';
import { BUSINESS_SCHEMAS } from '../../src/mcp/tool-schemas.ts';
import { COMMAND_ID_FIELD, wireSchema, modelSchema, withoutCommandId } from '../../src/mcp/command-id.ts';

const ALL = Object.values(TOOL) as ToolName[];

const V = 'M7lc1UVf-VE';
/** One valid business input per tool, from contracts/mcp-tools.md. */
const SAMPLES: Readonly<Record<ToolName, readonly Record<string, unknown>[]>> = {
  [TOOL.playbackPlay]: [{}], [TOOL.playbackPause]: [{}], [TOOL.playbackStop]: [{}],
  [TOOL.playbackSeek]: [{ mode: 'absolute', seconds: 90 }, { mode: 'relative', seconds: -10 }],
  [TOOL.playbackSeekToChapter]: [{ query: 'intro' }],
  [TOOL.playbackSetRate]: [{ rate: 1.5 }], [TOOL.playbackSetVolume]: [{ volume: 40 }],
  [TOOL.playbackSetMuted]: [{ muted: true }], [TOOL.playbackSetCaptions]: [{ enabled: true }, { enabled: true, track: 'en' }],
  [TOOL.playbackNext]: [{}], [TOOL.playbackPrevious]: [{}], [TOOL.playbackGetState]: [{}],
  [TOOL.catalogSearch]: [{ query: 'state machines' }, { query: 'x', publishedAfter: 0 }],
  [TOOL.catalogNarrow]: [{}, { maxDurationSeconds: 600, titleContains: 'fsm' }],
  [TOOL.catalogGetCurrentResults]: [{}], [TOOL.catalogResolveReference]: [{ reference: 'the third one' }], [TOOL.catalogGetQuota]: [{}],
  [TOOL.queueAdd]: [{ videoIds: [V] }, { videoIds: [V], position: 'next' }],
  [TOOL.queueRemove]: [{ videoIds: [V] }, { entryIds: ['q1'] }],
  [TOOL.queueReorder]: [{ videoId: V, toIndex: 0 }], [TOOL.queueClear]: [{}], [TOOL.queueGet]: [{}],
  [TOOL.curationCreateCollection]: [{ name: 'Favourites' }],
  [TOOL.curationAddToCollection]: [{ collectionId: 'c1', videoIds: [V] }],
  [TOOL.curationRemoveFromCollection]: [{ collectionId: 'c1', videoIds: [V] }],
  [TOOL.curationDeleteCollection]: [{ collectionId: 'c1' }],
  [TOOL.curationSetLabel]: [{ videoId: V, label: 'Q3 retro' }, { videoId: V, label: null }],
  [TOOL.curationAddTags]: [{ videoIds: [V], tags: ['onboarding'] }],
  [TOOL.curationRemoveTags]: [{ videoIds: [V], tags: ['onboarding'] }],
  [TOOL.activityList]: [{}, { limit: 10 }], [TOOL.activityUndo]: [{ entryId: 'e1' }], [TOOL.activityDescribeRecent]: [{}, { count: 3 }],
};

describe('every tool has a business schema (contracts/mcp-tools.md)', () => {
  it.each(ALL)('%s declares additionalProperties:false and lists required', (tool) => {
    const s = BUSINESS_SCHEMAS[tool];
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(Array.isArray(s.required)).toBe(true);
  });
});

describe('the reserved commandId field (research R7)', () => {
  it.each(ALL)('%s: the model schema is exactly the wire schema without commandId', (tool) => {
    const wire = wireSchema(tool);
    const model = modelSchema(wire);
    expect(wire.properties).toHaveProperty(COMMAND_ID_FIELD);
    expect(wire.required).toContain(COMMAND_ID_FIELD);
    expect(model.properties).not.toHaveProperty(COMMAND_ID_FIELD);
    expect(model.required).not.toContain(COMMAND_ID_FIELD);
    // Every business constraint survives both derivations unchanged.
    expect(model).toEqual(BUSINESS_SCHEMAS[tool]);
    const wireBusiness = Object.fromEntries(Object.entries(wire.properties).filter(([k]) => k !== COMMAND_ID_FIELD));
    expect(wireBusiness).toEqual(BUSINESS_SCHEMAS[tool].properties);
    expect(wire.additionalProperties).toBe(false);
  });

  it('a business schema may not already use the reserved name', () => {
    for (const tool of ALL) {
      expect(BUSINESS_SCHEMAS[tool].properties ?? {}).not.toHaveProperty(COMMAND_ID_FIELD);
    }
  });

  it('a call without commandId fails the wire schema; with it, the business input passes', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(wireSchema(TOOL.playbackSeek));
    expect(validate({ mode: 'relative', seconds: -10 })).toBe(false);
    expect(validate({ mode: 'relative', seconds: -10, [COMMAND_ID_FIELD]: 'cmd-1' })).toBe(true);
    expect(validate({ mode: 'sideways', seconds: -10, [COMMAND_ID_FIELD]: 'cmd-1' })).toBe(false);
  });

  it.each(ALL)('%s: an input the business schema accepts stays valid on the wire once commandId is added', (tool) => {
    // Catches constraints that count properties or otherwise break when the
    // reserved field is added — a queue.remove built with maxProperties:1
    // passed every other case here and would have refused every real call.
    const ajv = new Ajv({ strict: false });
    const business = ajv.compile(BUSINESS_SCHEMAS[tool]);
    const wire = ajv.compile(wireSchema(tool));
    for (const sample of SAMPLES[tool]) {
      expect(business(sample)).toBe(true);
      expect(wire({ ...sample, [COMMAND_ID_FIELD]: 'cmd-1' })).toBe(true);
    }
  });

  it('queue.remove takes videoIds or entryIds, never both and never neither', () => {
    const ajv = new Ajv({ strict: false });
    const wire = ajv.compile(wireSchema(TOOL.queueRemove));
    const id = { [COMMAND_ID_FIELD]: 'cmd-1' };
    expect(wire({ ...id, videoIds: ['M7lc1UVf-VE'] })).toBe(true);
    expect(wire({ ...id, entryIds: ['q1'] })).toBe(true);
    expect(wire({ ...id, videoIds: ['M7lc1UVf-VE'], entryIds: ['q1'] })).toBe(false);
    expect(wire({ ...id })).toBe(false);
  });

  it('withoutCommandId hands a handler only business input', () => {
    expect(withoutCommandId({ seconds: 5, [COMMAND_ID_FIELD]: 'cmd-9' })).toEqual({ commandId: 'cmd-9', input: { seconds: 5 } });
    expect(withoutCommandId({ seconds: 5 })).toEqual({ commandId: null, input: { seconds: 5 } });
  });
});
