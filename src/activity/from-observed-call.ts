import type { ActivityRecorder } from './record-writer.ts';
import { REFUSAL_REASON, isRefusalReason, type RefusalReason } from '../vocab/refusal-reasons.ts';

/**
 * Maps the provider's observed calls onto activity entries — for calls a check
 * refused BEFORE any handler ran, and only those. A call that reached its
 * handler is recorded by the handler path, which knows its outcome and effect;
 * a cancelled call is not recorded here at all (see below).
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

export function recordObservedCall(recorder: ActivityRecorder, event: ObservedCallLike): void {
  if (event.phase !== CALL_PHASE_RESULT && event.phase !== CALL_PHASE_ERROR) return;

  const invoke = event.gates.find((g) => g.step === INVOKE_STEP);
  if (invoke === undefined) {
    // Guessing either way writes a duplicate or drops a call. Neither is
    // acceptable evidence, so the malformed event is reported, not absorbed.
    throw new Error(`Observed call ${String(event.callId)} (${event.name}) carries no ${INVOKE_STEP} gate; cannot tell whether a handler ran`);
  }
  // A handler ran and recorded this call itself, with its outcome and effect.
  if (invoke.outcome !== NOT_RUN) return;

  const code = codeOf(event.failure);
  /**
   * A cancellation is never recorded here (decided 2026-09-14).
   *
   * The library's cancellation path leaves `invoke` at `notRun` even when the
   * handler DID run, and 0.3.0 gives a handler nothing to correlate its call
   * with — so recording cancellations here meant inferring which call was
   * which. Five review rounds each found another ordering the inference got
   * wrong. Now: if the handler ran, its own entry stands; if it never ran,
   * nothing happened, and the withdrawal shows at the turn level instead.
   * Exact, with no inference. What IS recorded here is exact too: a call a
   * check refused before any handler, which the runtime states outright.
   */
  if (code === CALL_CANCELLED || code === CALL_ABANDONED) return;
  if (event.phase === CALL_PHASE_RESULT) {
    // A result with no handler run is not a state the runtime describes.
    throw new Error(`Observed call ${String(event.callId)} (${event.name}) produced a result without running its handler`);
  }

  recorder.record({
    callId: `${event.route ?? 'agent'}:${String(event.callId)}`,
    toolName: event.name,
    arguments: event.arguments ?? null,
    description: `Refused ${event.name}.`,
    result: 'failed',
    // Never empty: the record writer throws on a non-success with no detail,
    // so a failure with no message still names its code.
    failureDetail: code ?? 'The call failed and the runtime reported no coded reason for it.',
    refusalReason: reasonFor(code),
  });
}
