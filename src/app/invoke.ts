import { ActivityRecorder } from '../activity/record-writer.ts';
import { isRefusal, type ToolResult } from '../mcp/result.ts';
import type { ToolName } from '../vocab/tool-names.ts';
import type { Effect } from '../activity/effects.ts';

/**
 * The single recorded invocation boundary for LOCAL calls.
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
  /** What a success changed, by stable identity. Absent means not reversible. */
  effect: Effect | null = null,
): Promise<ToolResult<T>> {
  counter += 1;
  const callId = `local:${String(counter)}`;
  try {
    const result = await run();
    recorder.record(
      isRefusal(result)
        ? {
            callId,
            toolName: tool,
            arguments: input,
            description: describe,
            result: 'failed',
            failureDetail: result.detail,
            refusalReason: result.reason,
          }
        : { callId, toolName: tool, arguments: input, description: describe, result: 'succeeded', effect },
    );
    return result;
  } catch (cause) {
    // A handler that throws must still leave evidence; an unrecorded crash is
    // an action nobody can account for (SC-006, IMMUNE-E).
    recorder.record({
      callId,
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
