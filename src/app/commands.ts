import { ok, refuse, type ToolResult } from '../mcp/result.ts';
import { REFUSAL_REASON } from '../vocab/refusal-reasons.ts';

/**
 * The single owner of commands and their order (FR-038, research R7).
 *
 * `issueSeq` is assigned when a command is ISSUED — the talk control released,
 * the text submitted, the button pressed — and never when its text or its
 * interpretation arrives. It never leaves the page: the backend carries only
 * `commandId`, and this registry is the only thing that knows what it means
 * (IMMUNE-N).
 */
export const COMMAND_ROUTE = {
  manual: 'manual',
  voice: 'voice',
  text: 'text',
  localMatcher: 'local_matcher',
  agent: 'agent',
} as const;

export type CommandRoute = (typeof COMMAND_ROUTE)[keyof typeof COMMAND_ROUTE];

export type CommandState = 'open' | 'revoked' | 'finished';

export interface Command {
  readonly commandId: string;
  readonly issueSeq: number;
  readonly route: CommandRoute;
  readonly issuedAt: number;
  readonly state: CommandState;
}

export class CommandRegistry {
  #seq = 0;
  readonly #commands = new Map<string, Command>();

  issue(route: CommandRoute, now: number = Date.now()): Command {
    this.#seq += 1;
    const command: Command = { commandId: `cmd-${String(this.#seq)}`, issueSeq: this.#seq, route, issuedAt: now, state: 'open' };
    this.#commands.set(command.commandId, command);
    return command;
  }

  get(commandId: string): Command | undefined {
    return this.#commands.get(commandId);
  }

  /**
   * Revokes locally FIRST, then runs `requestRemoteCancel`. A late call that
   * races the remote cancellation must already find the command revoked —
   * MCP cancellation may lose that race or be ignored (codex, R7).
   */
  revoke(commandId: string, requestRemoteCancel?: () => void): boolean {
    const c = this.#commands.get(commandId);
    if (c === undefined || c.state !== 'open') return false;
    this.#commands.set(commandId, { ...c, state: 'revoked' });
    requestRemoteCancel?.();
    return true;
  }

  finish(commandId: string): void {
    const c = this.#commands.get(commandId);
    if (c !== undefined && c.state === 'open') this.#commands.set(commandId, { ...c, state: 'finished' });
  }

  /**
   * What an arriving call is attributed to. Never substitutes another command:
   * an unknown, revoked or finished id is refused, not re-attributed to
   * whatever happens to be current.
   */
  resolveForCall(commandId: string): ToolResult<Command> {
    const c = this.#commands.get(commandId);
    if (c === undefined) {
      return refuse(REFUSAL_REASON.unknownCommand, `No command ${commandId} was issued on this page, so the call was not applied.`);
    }
    if (c.state === 'revoked') {
      return refuse(REFUSAL_REASON.commandCancelled, `Command ${commandId} was cancelled, so this call was not applied.`);
    }
    if (c.state === 'finished') {
      return refuse(REFUSAL_REASON.commandFinished, `Command ${commandId} has already finished; a late call is not applied.`);
    }
    return ok(c);
  }
}
