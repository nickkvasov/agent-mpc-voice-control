/**
 * FR-041: what is retained of command transcripts is visible, and the person
 * can clear it.
 *
 * No audio is retained — it never leaves the device and is not stored — so this
 * governs the recognised TEXT only, and says so rather than letting "clear
 * history" imply it is deleting recordings that never existed.
 */
export interface HistoryControlsProps {
  readonly commandCount: number;
  readonly onClear: () => void;
}

export function HistoryControls({ commandCount, onClear }: HistoryControlsProps) {
  return (
    <section data-testid="history-controls" style={{ fontSize: '0.85rem', color: '#555', margin: '0.5rem 0' }}>
      <span data-testid="history-count">
        {commandCount === 0
          ? 'No commands are stored on this device.'
          : `${String(commandCount)} command${commandCount === 1 ? '' : 's'} stored on this device — the recognised text, never the audio.`}
      </span>{' '}
      <button type="button" data-testid="clear-history" disabled={commandCount === 0} onClick={onClear}>
        Clear command history
      </button>
    </section>
  );
}
