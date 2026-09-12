/**
 * The single ordering boundary for every command, whatever issued it.
 *
 * FR-038: commands apply in the order ISSUED. A spoken command's transcript
 * resolves after the person let go, so a click made during that gap would
 * otherwise be applied first and then overridden by the older utterance. Each
 * command reserves its place when issued, not when its text arrives.
 *
 * Extracted into production code deliberately: the first version of this lived
 * only inside a test, so deleting the real implementation left every ordering
 * test green — an assertion that could not fail (Gate C).
 */
export interface CommandChainOptions {
  /** Reported rather than swallowed; a failing command must not be silent. */
  readonly onError?: (cause: unknown) => void;
}

export class CommandChain {
  #tail: Promise<void> = Promise.resolve();
  readonly #onError: ((cause: unknown) => void) | undefined;

  constructor(options: CommandChainOptions = {}) {
    this.#onError = options.onError;
  }

  /**
   * Reserves this command's position now and runs it when its text arrives.
   *
   * A command that throws is contained: the chain must not stay rejected, or
   * one bad handler would permanently disable voice, typing and every button
   * until reload (Gate C).
   */
  enqueue(resolveText: () => Promise<string>, run: (text: string) => Promise<void> | void): void {
    this.#tail = this.#tail.then(async () => {
      try {
        const text = await resolveText();
        if (text.trim() === '') return;
        await run(text);
      } catch (cause) {
        this.#onError?.(cause);
      }
    });
  }

  /** Resolves once everything enqueued so far has been applied. */
  settled(): Promise<void> {
    return this.#tail;
  }
}
