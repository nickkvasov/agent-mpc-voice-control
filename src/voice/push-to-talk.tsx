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
  /**
   * Called at RELEASE with a promise of the transcript, not with the text.
   *
   * The final transcript arrives after `stop()`, so handing over the text would
   * place the command in the queue whenever recognition happened to finish —
   * letting a later click overtake an earlier utterance. Handing over the
   * promise reserves the command's position the moment the person let go
   * (FR-038).
   */
  readonly onUtterance: (pending: Promise<string>) => void;
  /** So the privacy disclosure can state what is actually true right now. */
  readonly onAvailabilityChange?: (available: boolean) => void;
}

type Phase = 'unprobed' | 'probing' | VoiceAvailability | 'installing';

export function PushToTalk({ onUtterance, onAvailabilityChange }: PushToTalkProps) {
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
  /**
   * The hold whose recogniser may still report an error.
   *
   * Distinct from `holdId`: releasing increments `holdId`, so guarding errors
   * on it alone suppressed a microphone denial that arrived just after release
   * even when no newer hold existed — the interface kept saying voice was ready
   * (Gate C). A recogniser is silenced only once a NEWER hold supersedes it.
   */
  const reportingHold = useRef(0);

  const ensureProbed = useCallback(async (): Promise<VoiceAvailability> => {
    setPhase('probing');
    const r = await probeOnDeviceRecognition();
    setPhase(r.availability);
    setDetail(r.detail);
    onAvailabilityChange?.(r.availability === 'available');
    return r.availability;
  }, []);

  const begin = useCallback(async () => {
    holdId.current += 1;
    const thisHold = holdId.current;
    reportingHold.current = thisHold;
    const availability =
      phase === 'unprobed' || phase === 'probing' ? await ensureProbed() : phase === 'installing' ? 'downloadable' : phase;
    // The hold ended (or another began) while the probe ran. Do not open a mic
    // nobody is holding.
    if (thisHold !== holdId.current) return;
    if (availability !== 'available') return;
    const started = startOnDeviceRecognition(globalThis, {
      onError: (detail) => {
        // Superseded by a newer hold: stay silent, and above all do not clear
        // the newer session handle — doing so left that microphone running
        // invisibly (Gate C).
        if (thisHold !== reportingHold.current) return;
        setDetail(detail);
        // Only clear capture state if this hold still owns it.
        if (thisHold === holdId.current) {
          setCapturing(false);
          session.current = null;
        }
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
    // Hand over the PROMISE, not the text: the caller reserves this command's
    // place in the queue now, and fills it when recognition finishes.
    onUtterance(s.stop());
  }, [onUtterance]);

  return (
    <section data-testid="push-to-talk" className="talk">
      <div className="talk-row">
      <button
        type="button"
        className="talk-button"
        data-testid="talk-button"
        onPointerDown={() => void begin()}
        onPointerUp={end}
        onPointerLeave={end}
      >
        Hold to talk
      </button>
      {capturing && (
        <span data-testid="capture-indicator" role="status" className="listening">
          ● Listening
        </span>
      )}
      {phase === 'downloadable' && (
        <button
          type="button"
          data-testid="install-voice"
          onClick={() => {
            setPhase('installing');
            setDetail('Downloading the on-device language…');
            void installLanguagePack().then((r) => {
              setPhase(r.availability);
              setDetail(r.detail);
              onAvailabilityChange?.(r.availability === 'available');
            });
          }}
        >
          Download voice support
        </button>
      )}
      </div>
      <p data-testid="voice-detail" className="quiet">{detail}</p>
    </section>
  );
}
