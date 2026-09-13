import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { recordObservedCall, type ObservedCallLike } from '../../src/activity/from-observed-call.ts';
import { HandlerStarts } from '../../src/activity/handler-starts.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';

/**
 * One call, one entry, and one owner of it (SC-006).
 *
 * The observer owns only calls refused BEFORE a handler ran — the boundary the
 * 2026-09-12 consult said the library exposes. A call that reached its handler
 * is recorded by the handler path, which alone knows its real outcome and its
 * undo effect. The runtime's own gate record says which case a call is: the
 * `invoke` step is `notRun` exactly when no handler ran.
 *
 * Recording every `result` here, as before, filed a handler's `{ok:false}` as
 * "succeeded" and left assistant actions with no effect to undo — latent only
 * because no tool was registered with MCP until Phase 9.
 */
const gates = (invoke: 'passed' | 'refused' | 'notRun', validate: 'passed' | 'refused' | 'notRun' = 'passed') => [
  { step: 'authenticate', outcome: 'passed' },
  { step: 'resolve', outcome: 'passed' },
  { step: 'capability', outcome: 'passed' },
  { step: 'policy', outcome: 'passed' },
  { step: 'validate', outcome: validate },
  { step: 'confirm', outcome: invoke === 'notRun' && validate === 'refused' ? 'notRun' : 'passed' },
  { step: 'invoke', outcome: invoke },
] as const;

describe('observed calls become activity entries only when no handler ran', () => {
  const rec = () => new ActivityRecorder(createInMemoryActivityStore());

  it('does not record a call whose handler ran — the handler path owns that entry', () => {
    const r = rec();
    recordObservedCall(r, { phase: 'result', callId: 1, name: 'playback.pause', gates: gates('passed') });
    recordObservedCall(r, {
      phase: 'error', callId: 2, name: 'playback.pause', gates: gates('refused'),
      failure: { vocabulary: 'runtime', code: 'MCP_TOOL_EXECUTION_ERROR' },
    });
    expect(r.entries()).toHaveLength(0);
  });

  it("records the agent's pre-handler schema refusal", () => {
    const r = rec();
    recordObservedCall(r, {
      phase: 'error', callId: 3, name: 'playback.seek', gates: gates('notRun', 'refused'),
      failure: { vocabulary: 'runtime', code: 'MCP_TOOL_ARGUMENTS_INVALID' },
    });
    expect(r.entries()).toHaveLength(1);
    expect(r.entries()[0]?.refusalReason).toBe(REFUSAL_REASON.argumentsInvalid);
    expect(r.entries()[0]?.failureDetail).toBe('MCP_TOOL_ARGUMENTS_INVALID');
  });

  it('ignores the start phase', () => {
    const r = rec();
    recordObservedCall(r, { phase: 'start', callId: 4, name: 'playback.play', gates: gates('notRun') });
    expect(r.entries()).toHaveLength(0);
  });

  it('says plainly when the runtime gave no coded reason, rather than inventing one', () => {
    const r = rec();
    recordObservedCall(r, { phase: 'error', callId: 5, name: 'queue.add', gates: gates('notRun'), failure: { vocabulary: 'uncoded' } });
    expect(r.entries()[0]?.failureDetail).toMatch(/no coded reason/);
  });

  it('fails loudly when the event does not say whether a handler ran', () => {
    const r = rec();
    const noInvoke = { phase: 'error', callId: 6, name: 'queue.add', gates: [], failure: { vocabulary: 'uncoded' } } as ObservedCallLike;
    expect(() => recordObservedCall(r, noInvoke)).toThrow(/invoke/);
    expect(r.entries()).toHaveLength(0);
  });
});

describe('a cancellation after the handler started is not a second entry (Phase 9 Gate C)', () => {
  const rec = () => new ActivityRecorder(createInMemoryActivityStore());
  const cancelledEvent = (callId: number, args: unknown): ObservedCallLike => ({
    phase: 'error', callId, name: 'queue.add', arguments: args,
    // The library's cancellation path leaves `invoke` at notRun even when the handler ran.
    gates: gates('notRun'),
    failure: { vocabulary: 'runtime', code: 'MCP_TOOL_CALL_CANCELLED' },
  });

  it('skips a cancelled call whose handler started — the handler recorded it', () => {
    const r = rec();
    const starts = new HandlerStarts();
    const args = { videoIds: ['M7lc1UVf-VE'], commandId: 'cmd-3' };
    starts.begin('queue.add', args);
    recordObservedCall(r, cancelledEvent(7, { commandId: 'cmd-3', videoIds: ['M7lc1UVf-VE'] }), starts);
    expect(r.entries()).toHaveLength(0);
  });

  it('records a cancelled call whose handler never started', () => {
    const r = rec();
    const starts = new HandlerStarts();
    recordObservedCall(r, cancelledEvent(8, { videoIds: ['M7lc1UVf-VE'], commandId: 'cmd-4' }), starts);
    expect(r.entries()).toHaveLength(1);
  });

  it('two identical starts are matched one each, never both by one event', () => {
    const r = rec();
    const starts = new HandlerStarts();
    const args = { videoIds: ['M7lc1UVf-VE'], commandId: 'cmd-5' };
    starts.begin('queue.add', args);
    recordObservedCall(r, cancelledEvent(9, args), starts);
    recordObservedCall(r, cancelledEvent(10, args), starts);
    expect(r.entries()).toHaveLength(1);
  });
});

