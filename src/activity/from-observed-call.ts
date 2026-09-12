import type { ActivityRecorder, RecordedCall } from './record-writer.ts';
import { REFUSAL_REASON, isRefusalReason, type RefusalReason } from '../vocab/refusal-reasons.ts';

/**
 * Maps the provider's observed calls onto activity entries.
 *
 * Only TERMINAL phases are recorded — `result` and `error`. The `start` phase is
 * deliberately ignored: recording it too would write two entries for one call,
 * which is the duplicate codex warned about at the consult.
 *
 * This is the boundary the Gate C review found unwired. Without it the recorder
 * existed and nothing fed it, so SC-006 held only in tests.
 */
/**
 * The library's failure is a discriminated union, and one arm — `uncoded` —
 * carries no code at all. That is not a gap to paper over: a failure with no
 * coded reason is a real state, and the entry must say so rather than invent
 * one (IMMUNE-U).
 */
export type ObservedFailureLike =
  | { readonly vocabulary: 'runtime' | 'route'; readonly code: string }
  | { readonly vocabulary: 'uncoded' };

export interface ObservedCallLike {
  readonly phase: string;
  readonly callId: number;
  readonly name: string;
  readonly route?: string;
  readonly failure?: ObservedFailureLike | undefined;
  readonly arguments?: unknown;
}

function codeOf(failure: ObservedFailureLike | undefined): string | undefined {
  return failure !== undefined && failure.vocabulary !== 'uncoded' ? failure.code : undefined;
}

export const CALL_PHASE_RESULT = 'result';
export const CALL_PHASE_ERROR = 'error';

/** The agent's own schema refusal, as distinct from a page script's. */
const AGENT_ARGUMENTS_INVALID = 'MCP_TOOL_ARGUMENTS_INVALID';

function reasonFor(code: string | undefined): RefusalReason {
  if (code === AGENT_ARGUMENTS_INVALID) return REFUSAL_REASON.argumentsInvalid;
  if (code !== undefined && isRefusalReason(code)) return code;
  return REFUSAL_REASON.capabilityUnsupported;
}

export function recordObservedCall(recorder: ActivityRecorder, event: ObservedCallLike): void {
  if (event.phase !== CALL_PHASE_RESULT && event.phase !== CALL_PHASE_ERROR) return;

  const base = {
    callId: `${event.route ?? 'agent'}:${String(event.callId)}`,
    toolName: event.name,
    arguments: event.arguments ?? null,
  };

  const call: RecordedCall =
    event.phase === CALL_PHASE_RESULT
      ? { ...base, description: `Ran ${event.name}.`, result: 'succeeded' }
      : {
          ...base,
          description: `Refused ${event.name}.`,
          result: 'failed',
          // Never empty: the record writer throws on a non-success with no
          // detail, so a failure with no message still names its code.
          failureDetail:
            codeOf(event.failure) ??
            'The call failed and the runtime reported no coded reason for it.',
          refusalReason: reasonFor(codeOf(event.failure)),
        };

  recorder.record(call);
}
