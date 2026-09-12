import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { recordObservedCall } from '../../src/activity/from-observed-call.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';

/**
 * Gate C found the recorder unwired: it existed and nothing fed it, so SC-006
 * held only where a test constructed entries by hand. This covers the boundary.
 */
describe('observed calls become activity entries', () => {
  const rec = () => new ActivityRecorder(createInMemoryActivityStore());

  it('records a terminal result', () => {
    const r = rec();
    recordObservedCall(r, { phase: 'result', callId: 1, name: 'playback.pause' });
    expect(r.entries()).toHaveLength(1);
    expect(r.entries()[0]?.result).toBe('succeeded');
  });

  it("records the agent's pre-handler schema refusal", () => {
    const r = rec();
    recordObservedCall(r, {
      phase: 'error', callId: 2, name: 'playback.seek',
      failure: { vocabulary: 'runtime', code: 'MCP_TOOL_ARGUMENTS_INVALID' },
    });
    expect(r.entries()[0]?.refusalReason).toBe(REFUSAL_REASON.argumentsInvalid);
    expect(r.entries()[0]?.failureDetail).toBe('MCP_TOOL_ARGUMENTS_INVALID');
  });

  it('ignores the start phase, so one call yields exactly one entry', () => {
    const r = rec();
    recordObservedCall(r, { phase: 'start', callId: 3, name: 'playback.play' });
    recordObservedCall(r, { phase: 'result', callId: 3, name: 'playback.play' });
    expect(r.entries()).toHaveLength(1);
  });

  it('says plainly when the runtime gave no coded reason, rather than inventing one', () => {
    const r = rec();
    recordObservedCall(r, { phase: 'error', callId: 4, name: 'queue.add', failure: { vocabulary: 'uncoded' } });
    expect(r.entries()[0]?.failureDetail).toMatch(/no coded reason/);
  });
});
