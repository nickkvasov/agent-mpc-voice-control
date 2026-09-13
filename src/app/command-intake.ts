import type { Command, CommandRegistry, CommandRoute } from './commands.ts';

/**
 * Where a spoken or typed command enters (FR-038, research R7).
 *
 * The command is issued the moment this is called — the talk control released,
 * the text submitted — before its text exists. A click made while a transcript
 * is still pending is therefore the NEWER command, and the utterance is refused
 * if it would apply over it.
 *
 * Extracted from `App.tsx` for the reason Phase 3's Gate C gave: intake logic
 * living in a React callback is logic no test can reach.
 */
export interface IntakeCallbacks {
  /** Runs with the resolved text. The command is finished after it settles. */
  readonly run: (command: Command, text: string) => Promise<void>;
  /** Recognition or text resolution failed. Reported, never swallowed. */
  readonly failed: (command: Command, cause: unknown) => void;
}

export function issueText(
  registry: CommandRegistry,
  route: CommandRoute,
  resolveText: () => Promise<string>,
  callbacks: IntakeCallbacks,
): { readonly command: Command; readonly settled: Promise<void> } {
  const command = registry.issue(route);
  const settled = (async () => {
    try {
      let text: string;
      try {
        text = await resolveText();
      } catch (cause) {
        callbacks.failed(command, cause);
        return;
      }
      // An empty transcript is nothing said, not a command to refuse.
      if (text.trim() === '') return;
      try {
        await callbacks.run(command, text);
      } catch (cause) {
        callbacks.failed(command, cause);
      }
    } finally {
      registry.finish(command.commandId);
    }
  })();
  return { command, settled };
}
