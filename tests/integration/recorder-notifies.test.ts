import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';

/**
 * The record view re-reads when the record changes, whoever wrote to it.
 *
 * Found in Phase 9: a refusal written by a registry call, or by the provider's
 * observer, landed in the record while the panel stayed empty — it refreshed
 * only after actions the page itself ran. The same defect Phase 7 fixed for one
 * path, arriving by two new ones; so the recorder notifies, instead of every
 * writer remembering to.
 */
describe('recorder notifies subscribers on every write', () => {
  it('on record and on markUndone, and stops after unsubscribe', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    let calls = 0;
    const off = r.subscribe(() => { calls += 1; });
    const e = r.record({ callId: 'a', toolName: 'queue.add', arguments: {}, description: 'x', result: 'succeeded' });
    r.markUndone(e.entryId);
    expect(calls).toBe(2);
    off();
    r.record({ callId: 'b', toolName: 'queue.add', arguments: {}, description: 'y', result: 'succeeded' });
    expect(calls).toBe(2);
  });

  it('a subscriber that throws does not stop the write or the other subscribers', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    const errors: unknown[] = [];
    let second = 0;
    r.subscribe(() => { throw new Error('bad listener'); }, (cause) => errors.push(cause));
    r.subscribe(() => { second += 1; });
    r.record({ callId: 'a', toolName: 'queue.add', arguments: {}, description: 'x', result: 'succeeded' });
    expect(r.entries()).toHaveLength(1);
    expect(second).toBe(1);
    expect(String(errors[0])).toMatch(/bad listener/);
  });
});
