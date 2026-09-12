import { useEffect, useRef, useState } from 'react';
import { probeOnDeviceRecognition, type VoiceAvailability } from './recognition.ts';

/**
 * Push-to-talk (the Q2 clarification).
 *
 * FR-002: audio is captured ONLY while the control is held, and the interface
 * shows unambiguously while it is capturing. SC-011 makes that testable: no
 * audio at any moment the indicator is absent.
 *
 * There is no wake word in this release, deliberately — see spec.md.
 */
export interface PushToTalkProps {
  readonly onUtterance: (text: string) => void;
}

export function PushToTalk({ onUtterance }: PushToTalkProps) {
  const [availability, setAvailability] = useState<VoiceAvailability | 'probing'>('probing');
  const [detail, setDetail] = useState('Checking whether this device can recognise speech locally…');
  const [capturing, setCapturing] = useState(false);
  const recognition = useRef<unknown>(null);

  useEffect(() => {
    let live = true;
    void probeOnDeviceRecognition().then((r) => {
      if (!live) return;
      setAvailability(r.availability);
      setDetail(r.detail);
    });
    return () => {
      live = false;
    };
  }, []);

  const usable = availability === 'available';

  return (
    <section data-testid="push-to-talk" style={{ margin: '0.5rem 0' }}>
      <button
        type="button"
        data-testid="talk-button"
        disabled={!usable}
        onPointerDown={() => {
          if (!usable) return;
          setCapturing(true);
        }}
        onPointerUp={() => {
          setCapturing(false);
          const text = (recognition.current as { lastText?: string } | null)?.lastText;
          if (typeof text === 'string' && text.trim() !== '') onUtterance(text);
        }}
        onPointerLeave={() => setCapturing(false)}
      >
        {usable ? 'Hold to talk' : 'Voice unavailable'}
      </button>
      {/* The capture indicator is present for exactly the capture window. */}
      {capturing && (
        <span data-testid="capture-indicator" role="status" style={{ marginLeft: '0.5rem', color: '#b00' }}>
          ● Listening
        </span>
      )}
      <p data-testid="voice-detail" style={{ fontSize: '0.85rem', color: '#555' }}>
        {detail}
      </p>
    </section>
  );
}
