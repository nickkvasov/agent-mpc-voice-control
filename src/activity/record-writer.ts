import type { RefusalReason } from '../vocab/refusal-reasons.ts';
import type { ToolName } from '../vocab/tool-names.ts';

/**
 * The activity record writer.
 *
 * Driven by the provider's observability callbacks rather than by wrapping each
 * handler. That is a decision, not a convenience: a handler wrapper cannot see a
 * call refused before the handler runs (schema-invalid arguments), and running
 * both a wrapper and an observer would write two entries for one call. See the
 * codex consult recorded in NOTES.md (2026-09-12).
 *
 * One writer, one subscription, exactly one entry per invocation — including
 * refusals (FR-029, SC-006, IMMUNE-E).
 */

export type EntryResult = 'succeeded' | 'failed' | 'partially_applied';

export type UndoState = 'undoable' | 'undone' | 'superseded' | 'not_reversible';

export interface ActivityEntry {
  readonly entryId: string;
  readonly commandId: string | null;
  readonly toolName: ToolName | string;
  readonly arguments: unknown;
  readonly description: string;
  readonly at: number;
  readonly result: EntryResult;
  /** Required whenever `result` is not `succeeded` (FR-032). */
  readonly failureDetail: string | null;
  readonly refusalReason: RefusalReason | null;
  readonly inverse: unknown | null;
  readonly undoState: UndoState;
  readonly supersededBy: string | null;
}

export interface ActivityStore {
  append(entry: ActivityEntry): void;
  list(): readonly ActivityEntry[];
}

export function createInMemoryActivityStore(): ActivityStore {
  const entries: ActivityEntry[] = [];
  return {
    append: (entry) => {
      entries.push(entry);
    },
    list: () => entries,
  };
}

export interface RecordedCall {
  readonly callId: string;
  readonly commandId?: string | null;
  readonly toolName: ToolName | string;
  readonly arguments: unknown;
  readonly description: string;
  readonly result: EntryResult;
  readonly failureDetail?: string | null;
  readonly refusalReason?: RefusalReason | null;
  readonly inverse?: unknown | null;
}

export class ActivityRecorder {
  readonly #store: ActivityStore;
  readonly #seen = new Set<string>();
  #counter = 0;

  constructor(store: ActivityStore) {
    this.#store = store;
  }

  /**
   * Records one invocation. Idempotent per `callId`: if both a result and an
   * error event arrive for the same call, the first wins and the second is
   * rejected loudly rather than silently producing a second entry.
   */
  record(call: RecordedCall): ActivityEntry {
    if (this.#seen.has(call.callId)) {
      throw new Error(`Activity entry already written for call ${call.callId}`);
    }
    if (call.result !== 'succeeded') {
      const detail = call.failureDetail ?? '';
      if (detail.trim() === '') {
        throw new Error(`Entry for ${call.toolName} is ${call.result} but carries no failureDetail`);
      }
    }
    this.#seen.add(call.callId);
    this.#counter += 1;
    const entry: ActivityEntry = {
      entryId: `e${this.#counter}`,
      commandId: call.commandId ?? null,
      toolName: call.toolName,
      arguments: call.arguments,
      description: call.description,
      at: Date.now(),
      result: call.result,
      failureDetail: call.failureDetail ?? null,
      refusalReason: call.refusalReason ?? null,
      inverse: call.inverse ?? null,
      undoState: call.inverse === undefined || call.inverse === null ? 'not_reversible' : 'undoable',
      supersededBy: null,
    };
    this.#store.append(entry);
    return entry;
  }

  entries(): readonly ActivityEntry[] {
    return this.#store.list();
  }
}
