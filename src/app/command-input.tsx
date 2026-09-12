import { useState } from 'react';

/**
 * Typed commands. FR-001 requires text and voice to be equivalent, and text is
 * the fallback whenever voice is refused — which, per the T008 spike, is a
 * normal condition rather than an edge case.
 */
export interface CommandInputProps {
  readonly onCommand: (text: string) => void;
}

export function CommandInput({ onCommand }: CommandInputProps) {
  const [text, setText] = useState('');
  return (
    <form
      data-testid="command-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() === '') return;
        onCommand(text);
        setText('');
      }}
      style={{ margin: '0.5rem 0' }}
    >
      <label>
        Type a command{' '}
        <input
          data-testid="command-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="pause, skip forward two minutes…"
          style={{ width: '22rem' }}
        />
      </label>{' '}
      <button type="submit" data-testid="command-submit">Send</button>
    </form>
  );
}
