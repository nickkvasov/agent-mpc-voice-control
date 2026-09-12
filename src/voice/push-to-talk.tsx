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
  /**
   * Whether the button is held RIGHT NOW, tracked apart from `capturing`.
   *
   * The first press probes, and the probe is asynchronous. If the person
   * released while it was still running, the continuation used to start the
   * microphone anyway and nothing ever stopped it — the mic stayed live after
   * release (Gate C). Every start now checks the hold is still the same one.
   */
  const holdId = useRef(0);

  const ensureProbed = useCallback(async (): Promise<VoiceAvailability> => {
    setPhase('probing');
    const r = await probeOnDeviceRecognition();
    setPhase(r.availability);
    setDetail(r.detail);
    return r.availability;
  }, []);

  const begin = useCallback(async () => {
    holdId.current += 1;
    const thisHold = holdId.current;
    const availability =
      phase === 'unprobed' || phase === 'probing' ? await ensureProbed() : phase === 'installing' ? 'downloadable' : phase;
    // The hold ended (or another began) while the probe ran. Do not open a mic
    // nobody is holding.
    if (thisHold !== holdId.current) return;
    if (availability !== 'available') return;
    const started = startOnDeviceRecognition(globalThis, {
      onError: (detail) => {
        setDetail(detail);
        setCapturing(false);
        session.current = null;
      },
    });
    if (!started.ok) {
      setDetail(started.detail);
      return;
    }
    if (thisHold !== holdId.current) {
      // Released during start-up: close it immediately rather than leaving it open.
      started.session.abort();
      return;
    }
    session.current = started.session;
    setCapturing(true);
  }, [phase, ensureProbed]);

  const end = useCallback(() => {
    // Invalidate any start still in flight, whether or not one is open yet.
    holdId.current += 1;
    setCapturing(false);
    const s = session.current;
    session.current = null;
    if (s === null) return;
    // The final transcript arrives after stop(); waiting for it is what makes a
    // prompt release usable at all.
    void s.stop().then((text) => {
      if (text.trim() !== '') onUtterance(text);
    });
  }, [onUtterance]);

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
