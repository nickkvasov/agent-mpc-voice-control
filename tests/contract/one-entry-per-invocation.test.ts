import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';

/**
 * T016 — SC-006: every action the assistant takes appears in the record.
 *
 * Per the codex consult in NOTES.md this covers calls refused BEFORE a handler
 * ran, which is why the recorder is driven by the provider's observer events
 * rather than by wrapping handlers.
 */
describe('one activity entry per invocation', () => {
  it('records a successful call', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    r.record({ callId: 'c1', toolName: TOOL.playbackPause, arguments: {}, description: 'Paused playback.', result: 'succeeded' });
    expect(r.entries()).toHaveLength(1);
  });

  it('records a call refused before the handler ran (schema-invalid arguments)', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    r.record({
      callId: 'c2',
      toolName: TOOL.playbackSeek,
      arguments: { seconds: 'ten' },
      description: 'Refused a seek: arguments did not match the declared schema.',
      result: 'failed',
      failureDetail: 'seconds must be a number',
      refusalReason: REFUSAL_REASON.argumentsInvalid,
    });
    const entries = r.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.refusalReason).toBe(REFUSAL_REASON.argumentsInvalid);
  });

  it('never writes two entries for one call', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    r.record({ callId: 'dup', toolName: TOOL.playbackPlay, arguments: {}, description: 'Started playback.', result: 'succeeded' });
    expect(() =>
      r.record({ callId: 'dup', toolName: TOOL.playbackPlay, arguments: {}, description: 'again', result: 'succeeded' }),
    ).toThrow(/already written/);
    expect(r.entries()).toHaveLength(1);
  });

  it('refuses to record a non-success with no failure detail (FR-032)', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    expect(() =>
      r.record({ callId: 'c3', toolName: TOOL.queueAdd, arguments: {}, description: 'partly added', result: 'partially_applied' }),
    ).toThrow(/no failureDetail/);
  });

  it('marks an entry with no inverse as not reversible rather than offering undo', () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    const e = r.record({ callId: 'c4', toolName: TOOL.catalogSearch, arguments: { query: 'x' }, description: 'Searched.', result: 'succeeded' });
    expect(e.undoState).toBe('not_reversible');
  });
});
