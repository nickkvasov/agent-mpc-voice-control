import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { recordObservedCall, type ObservedCallLike } from '../../src/activity/from-observed-call.ts';
import { HandlerStarts } from '../../src/activity/handler-starts.ts';

/**
 * Every interleaving of two identical concurrent calls records each call once.
 *
 * Four review rounds each found one ordering the previous rule got wrong. This
 * replaces arguing about orderings with enumerating them, against the REAL
 * HandlerStarts and recordObservedCall. A handler that ran writes its own entry
 * (not modelled here), so the observer must write exactly one entry per call
 * whose handler never started, and none for the others.
 */
type Event = 'begin' | 'settle' | 'abort' | 'terminal:passed' | 'terminal:cancelled';

const LIFECYCLES: Readonly<Record<string, readonly Event[]>> = {
  completed: ['begin', 'settle', 'terminal:passed'],
  cancelledWhileRunning_settlesAfterTerminal: ['begin', 'abort', 'terminal:cancelled', 'settle'],
  cancelledWhileRunning_settlesBeforeTerminal: ['begin', 'abort', 'settle', 'terminal:cancelled'],
  completedThenAbortedLate: ['begin', 'settle', 'abort', 'terminal:passed'],
  cancelledBeforeHandler: ['terminal:cancelled'],
};

function interleavings(a: readonly Event[], b: readonly Event[]): [0 | 1, Event][][] {
  if (a.length === 0) return [b.map((e) => [1, e] as [0 | 1, Event])];
  if (b.length === 0) return [a.map((e) => [0, e] as [0 | 1, Event])];
  return [
    ...interleavings(a.slice(1), b).map((r) => [[0, a[0] as Event] as [0 | 1, Event], ...r]),
    ...interleavings(a, b.slice(1)).map((r) => [[1, b[0] as Event] as [0 | 1, Event], ...r]),
  ];
}

const ARGS = { videoIds: ['M7lc1UVf-VE'], commandId: 'cmd-1' };
const GATES = (invoke: 'passed' | 'notRun') =>
  ['authenticate', 'resolve', 'capability', 'policy', 'validate', 'confirm', 'invoke'].map((step) => ({
    step, outcome: step === 'invoke' ? invoke : 'passed',
  }));

function run(order: readonly [0 | 1, Event][]): number {
  const recorder = new ActivityRecorder(createInMemoryActivityStore());
  const starts = new HandlerStarts();
  const controllers = [new AbortController(), new AbortController()];
  let callId = 0;
  for (const [who, ev] of order) {
    const signal = (controllers[who] as AbortController).signal;
    if (ev === 'begin') starts.begin('queue.add', { ...ARGS }, signal);
    else if (ev === 'settle') starts.settle('queue.add', { ...ARGS }, signal);
    else if (ev === 'abort') (controllers[who] as AbortController).abort();
    else {
      callId += 1;
      const event: ObservedCallLike = ev === 'terminal:passed'
        ? { phase: 'result', callId, name: 'queue.add', arguments: { ...ARGS }, gates: GATES('passed') }
        : { phase: 'error', callId, name: 'queue.add', arguments: { ...ARGS }, gates: GATES('notRun'), failure: { vocabulary: 'runtime', code: 'MCP_TOOL_CALL_CANCELLED' } };
      recordObservedCall(recorder, event, starts);
    }
  }
  return recorder.entries().length;
}

describe('handler starts are matched exactly, in every ordering of two identical calls', () => {
  const names = Object.keys(LIFECYCLES);
  const cases = names.flatMap((a) => names.map((b) => [a, b] as const));

  it.each(cases)('%s + %s', (a, b) => {
    const expected = [a, b].filter((n) => n === 'cancelledBeforeHandler').length;
    const wrong: string[] = [];
    for (const order of interleavings(LIFECYCLES[a] as Event[], LIFECYCLES[b] as Event[])) {
      const got = run(order);
      if (got !== expected) wrong.push(`${order.map(([w, e]) => `${w === 0 ? 'A' : 'B'}:${e}`).join(' ')} → ${String(got)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('covers all 900 orderings', () => {
    const count = cases.reduce((n, [a, b]) => n + interleavings(LIFECYCLES[a] as Event[], LIFECYCLES[b] as Event[]).length, 0);
    expect(count).toBe(900);
  });
});
