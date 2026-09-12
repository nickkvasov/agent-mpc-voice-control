import { useCallback, useRef, useState } from 'react';
import {
  installLanguagePack,
  probeOnDeviceRecognition,
  startOnDeviceRecognition,
  type RecognitionSession,
  type VoiceAvailability,
} from './recognition.ts';

/**
 * Push-to-talk (the Q2 clarification).
 *
 * FR-002: audio is captured ONLY while the control is held, and the interface
 * shows unambiguously while it is capturing. SC-011 makes that testable.
 *
 * **The probe is NOT run on mount.** `available({processLocally:true})` kills
 * the renderer in headless Chrome (T008), so probing at mount crashed the page
 * for every e2e run — it broke the suite, and Gate C caught it. It now runs on
 * the person's first deliberate press, which also avoids a surprise permission
 * prompt on load.
 */
export interface PushToTalkProps {
  readonly onUtterance: (text: string) => void;
}

type Phase = 'unprobed' | 'probing' | VoiceAvailability | 'installing';

export function PushToTalk({ onUtterance }: PushToTalkProps) {
  const [phase, setPhase] = useState<Phase>('unprobed');
  const [detail, setDetail] = useState('Press and hold to talk. Voice is checked the first time you use it.');
  const [capturing, setCapturing] = useState(false);
  const session = useRef<RecognitionSession | null>(null);

  const ensureProbed = useCallback(async (): Promise<VoiceAvailability> => {
    setPhase('probing');
    const r = await probeOnDeviceRecognition();
    setPhase(r.availability);
    setDetail(r.detail);
    return r.availability;
  }, []);

  const begin = useCallback(async () => {
    const availability = phase === 'unprobed' || phase === 'probing' ? await ensureProbed() : phase === 'installing' ? 'downloadable' : phase;
    if (availability !== 'available') return;
    const started = startOnDeviceRecognition();
    if (!started.ok) {
      setDetail(started.detail);
      return;
    }
    session.current = started.session;
    setCapturing(true);
  }, [phase, ensureProbed]);

  const end = useCallback(() => {
    if (!capturing) return;
    setCapturing(false);
    const s = session.current;
    session.current = null;
    if (s === null) return;
    const text = s.stop();
    if (text.trim() !== '') onUtterance(text);
  }, [capturing, onUtterance]);

  return (
    <section data-testid="push-to-talk" style={{ margin: '0.5rem 0' }}>
      <button
        type="button"
        data-testid="talk-button"
        onPointerDown={() => void begin()}
        onPointerUp={end}
        onPointerLeave={end}
      >
        Hold to talk
      </button>
      {capturing && (
        <span data-testid="capture-indicator" role="status" style={{ marginLeft: '0.5rem', color: '#b00' }}>
          ● Listening
        </span>
      )}
      {phase === 'downloadable' && (
        <button
          type="button"
          data-testid="install-voice"
          style={{ marginLeft: '0.5rem' }}
          onClick={() => {
            setPhase('installing');
            setDetail('Downloading the on-device language…');
            void installLanguagePack().then((r) => {
              setPhase(r.availability);
              setDetail(r.detail);
            });
          }}
        >
          Download voice support
        </button>
      )}
      <p data-testid="voice-detail" style={{ fontSize: '0.85rem', color: '#555' }}>{detail}</p>
    </section>
  );
}
