import { ActivityRecorder } from '../activity/record-writer.ts';
import { isRefusal, type ToolResult } from '../mcp/result.ts';
import type { ToolName } from '../vocab/tool-names.ts';
import type { Effect } from '../activity/effects.ts';

/**
 * The single recorded invocation boundary for every call that reaches a
 * handler — buttons, the matcher, and since Phase 9 the assistant's calls too.
 * Calls refused before any handler ran are recorded by the provider's observer
 * instead (`activity/from-observed-call.ts`), so each call has one entry.
 *
 * Gate C found that typed commands and control buttons called the tool
 * functions directly, bypassing the activity recorder entirely — the recorder is
 * fed by the provider's observer callbacks, which a local call never emits. So
 * every action taken by the matcher or by a button left no entry, and SC-006
 * held only for the agent path.
 *
 * Everything local goes through here, so one call still means exactly one entry
 * whichever path issued it.
 */
let counter = 0;

export async function invokeRecorded<T>(
  recorder: ActivityRecorder,
  tool: ToolName,
  input: Record<string, unknown>,
  describe: string,
  run: () => Promise<ToolResult<T>> | ToolResult<T>,
  /**
   * What a success changed, by stable identity. Absent means not reversible.
   *
   * A FUNCTION rather than a value, because the effect is usually only knowable
   * from the result. Attaching it separately after the call was worse than
   * either: `attachEffect` writes to the LAST entry, and callers were invoking
   * it inside `run` — before this function had written its entry — so the
   * effect landed on the PREVIOUS action. A search became undoable and undoing
   * it reported "Undid: Search" while removing a collection member (Gate B).
   */
  effectOf: ((value: T) => Effect | null) | null = null,
  /** The command this call serves (research R7). Null only for calls with no command. */
  commandId: string | null = null,
): Promise<ToolResult<T>> {
  counter += 1;
  const callId = `local:${String(counter)}`;
  try {
    const result = await run();
    recorder.record(
      isRefusal(result)
        ? {
            callId,
            commandId,
            toolName: tool,
            arguments: input,
            description: describe,
            result: 'failed',
            failureDetail: result.detail,
            refusalReason: result.reason,
          }
        : {
            callId,
            commandId,
            toolName: tool,
            arguments: input,
            description: describe,
            result: 'succeeded',
            effect: effectOf === null ? null : effectOf(result.value),
          },
    );
    return result;
  } catch (cause) {
    // A handler that throws must still leave evidence; an unrecorded crash is
    // an action nobody can account for (SC-006, IMMUNE-E).
    recorder.record({
      callId,
      commandId,
      toolName: tool,
      arguments: input,
      description: describe,
      result: 'failed',
      failureDetail: `The handler threw: ${String(cause)}`,
    });
    throw cause;
  }
}

export function __resetInvokeCounter(): void {
  counter = 0;
}
