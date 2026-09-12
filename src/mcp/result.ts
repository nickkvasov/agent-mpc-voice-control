import type { RefusalReason } from '../vocab/refusal-reasons.ts';

/**
 * The shape every tool handler returns.
 *
 * Constitution III (NON-NEGOTIABLE): a call reports either what it did or why
 * it did not. There is no third outcome, and the type makes the third outcome
 * unrepresentable — a handler cannot return success without a payload, and
 * cannot refuse without naming a reason.
 */
export type ToolOk<T> = { readonly ok: true; readonly value: T };

export type ToolRefusal = {
  readonly ok: false;
  readonly reason: RefusalReason;
  /** What specifically could not be established, in the interface's vocabulary. */
  readonly detail: string;
  /** Set when the refusal is expected to clear on its own, e.g. after an ad. */
  readonly retryable?: boolean;
};

export type ToolResult<T> = ToolOk<T> | ToolRefusal;

export function ok<T>(value: T): ToolOk<T> {
  return { ok: true, value };
}

export function refuse(reason: RefusalReason, detail: string, retryable?: boolean): ToolRefusal {
  if (detail.trim() === '') {
    // A refusal with no reason text is the silent failure this type exists to
    // prevent, so it fails here rather than reaching a person (IMMUNE-U).
    throw new Error(`Refusal ${reason} was given no detail`);
  }
  return retryable === undefined ? { ok: false, reason, detail } : { ok: false, reason, detail, retryable };
}

export function isRefusal<T>(result: ToolResult<T>): result is ToolRefusal {
  return result.ok === false;
}
