import { describe, expect, it } from 'vitest';
import { refuseUnavailableView, viewOwning, isDeclared } from '../../src/mcp/tool-availability.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';

/** FR-035: name the view, never report a generic failure. */
describe('unavailable view', () => {
  it('names the view that owns each tool family', () => {
    expect(viewOwning(TOOL.playbackPause)).toBe('the player');
    expect(viewOwning(TOOL.catalogSearch)).toBe('the search results');
    expect(viewOwning(TOOL.queueAdd)).toBe('the queue');
    expect(viewOwning(TOOL.curationSetLabel)).toBe('the collections panel');
    expect(viewOwning(TOOL.activityUndo)).toBe('the activity record');
  });

  it('refuses with the view named and something to do about it', () => {
    const r = refuseUnavailableView(TOOL.queueAdd);
    expect(r.reason).toBe(REFUSAL_REASON.viewNotOpen);
    expect(r.detail).toMatch(/the queue/);
    expect(r.detail).toMatch(/Open the queue and try again/);
  });

  it('still refuses usefully for a tool it does not recognise', () => {
    const r = refuseUnavailableView('mystery.tool');
    expect(r.detail).toMatch(/not available right now/);
  });

  it('treats absence from the declared set as a fact, not a failure', () => {
    expect(isDeclared(TOOL.playbackPause, [TOOL.playbackPause])).toBe(true);
    expect(isDeclared(TOOL.playbackPause, [])).toBe(false);
  });

  it('every tool in the vocabulary has an owning view', () => {
    for (const tool of Object.values(TOOL)) {
      expect(viewOwning(tool), tool).not.toBeNull();
    }
  });
});
