import type { Command, CommandRegistry } from './commands.ts';
import { refuse, type ToolResult } from '../mcp/result.ts';
import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';
import type { CommandDomain } from '../vocab/command-domains.ts';

/**
 * Per-domain order, and the refusal of work a newer command overtook
 * (FR-038, research R7).
 *
 * Each domain is an exclusive lane. A call takes its place in every lane it
 * touches at the moment `run` is called — so a button pressed before another
 * applies before it, however slow it is — and waits only for its own lanes.
 * Nothing waits across domains.
 *
 * The overtaking check is made when the call HOLDS its lanes, immediately
 * before the action runs, and nothing else in those lanes can interleave while
 * it runs. Checking at handler entry instead lets a call that awaited a
 * confirmation or a search overwrite a command that applied meanwhile (codex).
 * Preparation that should not hold a lane — a person's confirmation — belongs
 * BEFORE `run`.
 */
export interface FenceHandle {
  /** Call once state has changed, so a partial effect still counts as applied. */
  markApplied(): void;
  /**
   * True once the call's command was revoked or its signal aborted. The check at
   * lane entry is not enough for an action that WAITS inside its lane — a search
   * on the network — so it asks again before it commits (Phase 12 Gate B).
   */
  cancelled(): boolean;
}

interface LastApplied {
  readonly issueSeq: number;
  readonly commandId: string;
}

export class DomainScheduler {
  readonly #commands: CommandRegistry;
  readonly #tails = new Map<CommandDomain, Promise<void>>();
  readonly #applied = new Map<CommandDomain, LastApplied>();

  constructor(commands: CommandRegistry) {
    this.#commands = commands;
  }

  run<T>(
    command: Command,
    domains: readonly CommandDomain[],
    action: (fence: FenceHandle) => Promise<ToolResult<T>> | ToolResult<T>,
    /** The call's signal. Checked when the lanes are held, before anything applies. */
    signal?: AbortSignal,
  ): Promise<ToolResult<T>> {
    const lanes = [...new Set(domains)];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    // Place in every lane synchronously, before any await, so placement order
    // is call order and two multi-lane calls cannot deadlock.
    const waitFor = lanes.map((d) => this.#tails.get(d) ?? Promise.resolve());
    for (const d of lanes) this.#tails.set(d, held);

    return (async () => {
      try {
        await Promise.all(waitFor);
        const current = this.#commands.get(command.commandId) ?? command;
        if (signal?.aborted === true) {
          // Its view closed or its caller cancelled while it waited. The library
          // has already reported the call abandoned; applying it anyway would
          // change state nobody is waiting for (Phase 9 Gate C).
          return refuse(REFUSAL_REASON.commandCancelled, 'Not applied: the call was cancelled while it waited — its view closed or its caller cancelled it.');
        }
        if (current.state === 'revoked') {
          return refuse(REFUSAL_REASON.commandCancelled, `Command ${command.commandId} was cancelled before it applied.`);
        }
        const newer = this.#newestAbove(lanes, command.issueSeq);
        if (newer !== null) {
          return refuse(
            REFUSAL_REASON.overtakenByNewerCommand,
            `Not applied: command ${newer.commandId}, issued later, already changed this. Ask again if you still want it.`,
          );
        }
        let applied = false;
        const result = await action({
          markApplied: () => { applied = true; },
          cancelled: () => signal?.aborted === true || this.#commands.get(command.commandId)?.state === 'revoked',
        });
        if (result.ok || applied) this.#raise(lanes, command);
        return result;
      } finally {
        release();
        for (const d of lanes) if (this.#tails.get(d) === held) this.#tails.delete(d);
      }
    })();
  }

  #newestAbove(lanes: readonly CommandDomain[], issueSeq: number): LastApplied | null {
    let newest: LastApplied | null = null;
    for (const d of lanes) {
      const last = this.#applied.get(d);
      if (last !== undefined && last.issueSeq > issueSeq && (newest === null || last.issueSeq > newest.issueSeq)) {
        newest = last;
      }
    }
    return newest;
  }

  #raise(lanes: readonly CommandDomain[], command: Command): void {
    for (const d of lanes) {
      const last = this.#applied.get(d);
      if (last === undefined || command.issueSeq >= last.issueSeq) {
        this.#applied.set(d, { issueSeq: command.issueSeq, commandId: command.commandId });
      }
    }
  }
}
