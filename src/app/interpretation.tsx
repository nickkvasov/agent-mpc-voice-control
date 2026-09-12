/**
 * FR-003: the system's reading of a spoken command is shown before or as it
 * acts, so a misrecognition is visible rather than only its consequences.
 */
export interface InterpretationProps {
  readonly heard: string | null;
  readonly interpretation: string | null;
  readonly outcome: string | null;
}

export function Interpretation({ heard, interpretation, outcome }: InterpretationProps) {
  if (heard === null && interpretation === null) return null;
  return (
    <section aria-live="polite" data-testid="interpretation" style={{ border: '1px solid #ccc', padding: '0.5rem', margin: '0.5rem 0' }}>
      {heard !== null && (
        <div data-testid="heard">
          Heard: <q>{heard}</q>
        </div>
      )}
      <div data-testid="understood">
        Understood as: {interpretation ?? <em>not understood</em>}
      </div>
      {outcome !== null && <div data-testid="outcome">{outcome}</div>}
    </section>
  );
}
