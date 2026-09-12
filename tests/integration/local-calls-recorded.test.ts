import { describe, expect, it } from 'vitest';
import { ActivityRecorder, createInMemoryActivityStore } from '../../src/activity/record-writer.ts';
import { invokeRecorded, __resetInvokeCounter } from '../../src/app/invoke.ts';
import { ok, refuse } from '../../src/mcp/result.ts';
import { REFUSAL_REASON } from '../../src/vocab/refusal-reasons.ts';
import { TOOL } from '../../src/vocab/tool-names.ts';

/**
 * Gate C found that typed commands and control buttons called the tool
 * functions directly, so every local action left no activity entry at all —
 * SC-006 held only for the agent path.
 */
describe('local invocations are recorded', () => {
  it('records a local success', async () => {
    __resetInvokeCounter();
    const r = new ActivityRecorder(createInMemoryActivityStore());
    await invokeRecorded(r, TOOL.playbackPause, {}, 'Pause playback', () => ok({ ok: true }));
    expect(r.entries()).toHaveLength(1);
    expect(r.entries()[0]?.result).toBe('succeeded');
  });

  it('records a local refusal with its reason', async () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    await invokeRecorded(r, TOOL.playbackPause, {}, 'Pause playback', () =>
      refuse(REFUSAL_REASON.notPlaying, 'Nothing is playing right now.'),
    );
    const e = r.entries()[0];
    expect(e?.result).toBe('failed');
    expect(e?.refusalReason).toBe(REFUSAL_REASON.notPlaying);
    expect(e?.failureDetail).toMatch(/Nothing is playing/);
  });

  it('records a handler that throws rather than losing the action', async () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    await expect(
      invokeRecorded(r, TOOL.playbackSeek, { seconds: 5 }, 'Seek', () => {
        throw new Error('player exploded');
      }),
    ).rejects.toThrow('player exploded');
    expect(r.entries()).toHaveLength(1);
    expect(r.entries()[0]?.failureDetail).toMatch(/player exploded/);
  });

  it('writes exactly one entry per call', async () => {
    const r = new ActivityRecorder(createInMemoryActivityStore());
    for (let i = 0; i < 4; i += 1) {
      await invokeRecorded(r, TOOL.playbackPlay, {}, 'Play', () => ok(i));
    }
    expect(r.entries()).toHaveLength(4);
  });
});
