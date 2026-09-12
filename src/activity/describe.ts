import { eligibility, type EligibilityContext, type EntryLike } from './supersession.ts';

/**
 * FR-033: a direct question about recent actions is answered FROM the record.
 *
 * Structural rather than a prompt instruction — the answer is generated from
 * the same entries the person can read, so the two cannot disagree.
 */
export interface DescribableEntry extends EntryLike {
  readonly entryId: string;
  readonly description: string;
  readonly failureDetail: string | null;
  readonly at: number;
}

export function describeRecent(entries: readonly DescribableEntry[], count = 5): string {
  if (entries.length === 0) return 'I have not done anything yet.';
  const recent = [...entries].sort((a, b) => b.sequence - a.sequence).slice(0, count);
  const lines = recent.map((e) => {
    if (e.result === 'failed') return `${e.description} — refused: ${e.failureDetail ?? 'no reason recorded'}`;
    if (e.result === 'partially_applied') return `${e.description} — only partly applied: ${e.failureDetail ?? 'no detail recorded'}`;
    if (e.undone) return `${e.description} — since undone`;
    return e.description;
  });
  return lines.length === 1 ? `I ${lowerFirst(lines[0] as string)}.` : `Most recent first:\n${lines.map((l) => `- ${l}`).join('\n')}`;
}

/** What the record will show for an entry's undo control. */
export function undoLabel(entry: DescribableEntry, all: readonly EntryLike[], context: EligibilityContext = {}): string {
  const e = eligibility(entry, all, context);
  switch (e.state) {
    case 'undoable':
      return 'Undo available.';
    case 'superseded': {
      // Name the blocking action. The reason alone said only "a later action",
      // and since the button is hidden the person never saw which one — so the
      // record explained that undo was unavailable without explaining why
      // (Gate C).
      const blocker = all.find((x) => x.sequence === e.bySequence) as DescribableEntry | undefined;
      return blocker?.description === undefined
        ? e.reason
        : `${e.reason} (blocked by: ${blocker.description})`;
    }
    case 'not_reversible':
      return e.reason;
    case 'unknown':
      return `Undo availability unknown: ${e.reason}`;
  }
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]?.toLowerCase() + s.slice(1);
}
