/**
 * FR-004: a command can be cancelled before it takes effect.
 *
 * FR-038: commands apply in the order issued, or one is explicitly refused.
 * A queue rather than a race, so a second utterance cannot overtake the first.
 */
export type CommandStatus = 'queued' | 'running' | 'applied' | 'cancelled' | 'refused';

export interface TrackedCommand {
  readonly id: string;
  readonly text: string;
  status: CommandStatus;
}

export class CommandQueue {
  readonly #items: TrackedCommand[] = [];
  #running = false;

  enqueue(id: string, text: string): TrackedCommand {
    const item: TrackedCommand = { id, text, status: 'queued' };
    this.#items.push(item);
    return item;
  }

  /** Cancellable only while it has not started; afterwards it is honestly too late. */
  cancel(id: string): { readonly cancelled: boolean; readonly detail: string } {
    const item = this.#items.find((i) => i.id === id);
    if (item === undefined) return { cancelled: false, detail: 'No such command.' };
    if (item.status !== 'queued') return { cancelled: false, detail: `Too late — that command is already ${item.status}.` };
    item.status = 'cancelled';
    return { cancelled: true, detail: 'Cancelled before it ran.' };
  }

  /** Runs queued commands strictly in order. */
  async drain(run: (c: TrackedCommand) => Promise<CommandStatus>): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (const item of this.#items) {
        if (item.status !== 'queued') continue;
        item.status = 'running';
        item.status = await run(item);
      }
    } finally {
      this.#running = false;
    }
  }

  items(): readonly TrackedCommand[] {
    return this.#items;
  }
}
