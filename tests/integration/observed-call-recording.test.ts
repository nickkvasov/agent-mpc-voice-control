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

describe('a cancellation is matched to the invocation it belongs to (Phase 9 Gate C, rounds 1 and 2)', () => {
  const rec = () => new ActivityRecorder(createInMemoryActivityStore());
  const args = { videoIds: ['M7lc1UVf-VE'], commandId: 'cmd-3' };
  const terminal = (callId: number, kind: 'cancelled' | 'passed'): ObservedCallLike =>
    kind === 'cancelled'
      ? {
          phase: 'error', callId, name: 'queue.add', arguments: { ...args },
          // The library's cancellation path leaves `invoke` at notRun even when the handler ran.
          gates: gates('notRun'),
          failure: { vocabulary: 'runtime', code: 'MCP_TOOL_CALL_CANCELLED' },
        }
      : { phase: 'result', callId, name: 'queue.add', arguments: { ...args }, gates: gates('passed') };

  it('skips a cancelled call whose own handler started — that handler recorded it', () => {
    const r = rec();
    const starts = new HandlerStarts();
    const b = new AbortController();
    starts.begin('queue.add', args, b.signal);
    b.abort();
    recordObservedCall(r, terminal(7, 'cancelled'), starts);
    expect(r.entries()).toHaveLength(0);
  });

  it('records a cancelled call whose handler never started', () => {
    const r = rec();
    recordObservedCall(r, terminal(8, 'cancelled'), new HandlerStarts());
    expect(r.entries()).toHaveLength(1);
  });

  it('an identical call still running is not mistaken for the cancelled one (codex round 2)', () => {
    const r = rec();
    const starts = new HandlerStarts();
    const a = new AbortController();
    starts.begin('queue.add', args, a.signal); // A is in its handler, not cancelled
    recordObservedCall(r, terminal(9, 'cancelled'), starts); // B, identical, cancelled before its handler
    expect(r.entries()).toHaveLength(1); // B is recorded
    recordObservedCall(r, terminal(10, 'passed'), starts); // A finishes; its handler recorded it
    expect(r.entries()).toHaveLength(1);
  });

  it('two identical cancelled starts are matched one each, never both by one event', () => {
    const r = rec();
    const starts = new HandlerStarts();
    const a = new AbortController();
    starts.begin('queue.add', args, a.signal);
    a.abort();
    recordObservedCall(r, terminal(11, 'cancelled'), starts);
    recordObservedCall(r, terminal(12, 'cancelled'), starts);
    expect(r.entries()).toHaveLength(1);
  });
});
