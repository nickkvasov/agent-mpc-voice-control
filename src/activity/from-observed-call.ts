import type { ActivityRecorder, RecordedCall } from './record-writer.ts';
import { REFUSAL_REASON, isRefusalReason, type RefusalReason } from '../vocab/refusal-reasons.ts';
import { handlerStarts as pageHandlerStarts, type HandlerStarts } from './handler-starts.ts';

/**
 * Maps the provider's observed calls onto activity entries — for calls refused
 * BEFORE any handler ran, and only those (Phase 9). A call that reached its
 * handler is recorded by the handler path, which knows its outcome and effect.
 *
 * Only TERMINAL phases are considered. The `start` phase is ignored: recording
 * it too would write two entries for one call, which is the duplicate codex
 * warned about at the consult.
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
  /** The runtime's record of each step. The `invoke` step says whether a handler ran. */
  readonly gates: readonly { readonly step: string; readonly outcome: string }[];
}

const INVOKE_STEP = 'invoke';
const CALL_CANCELLED = 'MCP_TOOL_CALL_CANCELLED';
const CALL_ABANDONED = 'MCP_TOOL_CALL_ABANDONED';
const NOT_RUN = 'notRun';

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

export function recordObservedCall(
  recorder: ActivityRecorder,
  event: ObservedCallLike,
  starts: HandlerStarts = pageHandlerStarts,
): void {
  if (event.phase !== CALL_PHASE_RESULT && event.phase !== CALL_PHASE_ERROR) return;

  const invoke = event.gates.find((g) => g.step === INVOKE_STEP);
  if (invoke === undefined) {
    // Guessing either way writes a duplicate or drops a call. Neither is
    // acceptable evidence, so the malformed event is reported, not absorbed.
    throw new Error(`Observed call ${String(event.callId)} (${event.name}) carries no ${INVOKE_STEP} gate; cannot tell whether a handler ran`);
  }
  if (invoke.outcome !== NOT_RUN) {
    // The handler ran and recorded this call; retire its start.
    starts.consume(event.name, event.arguments, false);
    return;
  }
  // `notRun` is not proof no handler ran: the library's cancellation path leaves
  // it unmarked. A cancelled call is skipped only if ITS handler started — its
  // signal is the aborted one (Phase 9 Gate C, rounds 1 and 2). Any other
  // pre-handler refusal never reached a handler, so it is recorded here.
  const code = codeOf(event.failure);
  const cancelled = code === CALL_CANCELLED || code === CALL_ABANDONED;
  if (cancelled && starts.consume(event.name, event.arguments, true)) return;

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
