import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { recordObservedCall, type ObservedCallLike } from '../../src/activity/from-observed-call.ts';
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
      arguments: { mode: 'sideways', seconds: 5, commandId: 'cmd-7' },
      failure: { vocabulary: 'runtime', code: 'MCP_TOOL_ARGUMENTS_INVALID' },
    });
    expect(r.entries()).toHaveLength(1);
    expect(r.entries()[0]?.refusalReason).toBe(REFUSAL_REASON.argumentsInvalid);
    // No handler ran to record what it was called with, so the observer must (data-model ActivityRecord).
    expect(r.entries()[0]?.arguments).toEqual({ mode: 'sideways', seconds: 5, commandId: 'cmd-7' });
    expect(r.entries()[0]?.commandId).toBe('cmd-7');
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

describe('cancellations are never recorded by the observer (decided 2026-09-14)', () => {
  const rec = () => new ActivityRecorder(createInMemoryActivityStore());
  const cancelled = (code: string, callId: number): ObservedCallLike => ({
    phase: 'error', callId, name: 'queue.add', gates: gates('notRun'),
    failure: { vocabulary: 'runtime', code },
  });

  it.each(['MCP_TOOL_CALL_CANCELLED', 'MCP_TOOL_CALL_ABANDONED'])(
    '%s with invoke notRun writes nothing — the handler recorded it if it ran, and nothing happened if it did not',
    (code) => {
      const r = rec();
      recordObservedCall(r, cancelled(code, 20));
      expect(r.entries()).toHaveLength(0);
    },
  );

  it('a result with no handler run is reported as an unexpected state, not recorded', () => {
    const r = rec();
    expect(() => recordObservedCall(r, { phase: 'result', callId: 21, name: 'queue.add', gates: gates('notRun') })).toThrow(/without running its handler/);
    expect(r.entries()).toHaveLength(0);
  });
});
