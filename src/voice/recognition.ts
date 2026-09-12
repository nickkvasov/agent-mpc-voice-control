/**
 * On-device speech recognition.
 *
 * Measured in the T008 spike rather than assumed (research.md R1):
 *   - `processLocally` defaults to false, and in that mode the browser MAY
 *     process audio remotely. Using the default would violate FR-043 while
 *     appearing to work, so it is never used.
 *   - `available({processLocally:true})` returns `"downloadable"` in real
 *     Chrome: a language pack must be installed first. Availability is
 *     THREE-valued, which the plan had assumed binary.
 *   - The call CRASHES the renderer in headless Chrome. The probe must survive
 *     the call dying, not merely returning false.
 */
export type VoiceAvailability = 'available' | 'downloadable' | 'unavailable';

export interface VoiceProbeResult {
  readonly availability: VoiceAvailability;
  /** Always present: a person refused voice is owed a reason (SC-009). */
  readonly detail: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognitionInstance;
  available?: (opts: { langs: readonly string[]; processLocally: boolean }) => Promise<string>;
  install?: (opts: { langs: readonly string[] }) => Promise<boolean>;
  prototype?: object;
}

export function speechRecognitionCtor(g: typeof globalThis = globalThis): SpeechRecognitionStatic | undefined {
  const w = g as unknown as Record<string, unknown>;
  const ctor = w['SpeechRecognition'] ?? w['webkitSpeechRecognition'];
  return typeof ctor === 'function' ? (ctor as unknown as SpeechRecognitionStatic) : undefined;
}

/**
 * An open capture.
 *
 * `stop()` is ASYNCHRONOUS because `SpeechRecognition.stop()` returns before
 * recognition finishes and the final `result` can arrive afterwards. Returning
 * the transcript synchronously submitted an interim or empty string whenever
 * the person released promptly, and the real result had nowhere to go (Gate C).
 *
 * `abort()` exists for the case where the hold ended before the session was
 * even handed back — the microphone must not be left running.
 */
export interface RecognitionSession {
  stop(): Promise<string>;
  abort(): void;
}

export type StartOutcome =
  | { readonly ok: true; readonly session: RecognitionSession }
  | { readonly ok: false; readonly detail: string };

export interface StartOptions {
  /** Errors arrive through onerror, not as a throw from start() (Gate C). */
  readonly onError?: (detail: string) => void;
}

const FINAL_RESULT_GRACE_MS = 1200;

/**
 * Opens a capture with `processLocally` forced on.
 *
 * Never falls back to the default mode: that mode lets the browser send audio
 * to a server, which FR-043 forbids, and a fallback here would be invisible.
 */
export function startOnDeviceRecognition(
  g: typeof globalThis = globalThis,
  options: StartOptions = {},
): StartOutcome {
  const Ctor = speechRecognitionCtor(g);
  if (Ctor === undefined) return { ok: false, detail: 'This browser has no speech recognition.' };
  try {
    const r = new Ctor();
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.processLocally = true;

    let heard = '';
    let finished = false;
    let resolveFinal: ((text: string) => void) | null = null;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      resolveFinal?.(heard);
      resolveFinal = null;
    };

    r.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let text = '';
      for (let i = 0; i < e.results.length; i += 1) {
        text += e.results[i]?.[0]?.transcript ?? '';
      }
      heard = text;
    };
    r.onerror = (e: { error?: string }) => {
      // Microphone denial and device failures arrive here, not as a throw.
      // Swallowing them left the interface showing "Listening" forever.
      options.onError?.(errorDetail(e.error));
      finish();
    };
    r.onend = finish;
    r.start();

    const stopOnce = (): void => {
      try {
        r.stop();
      } catch {
        // Stopping an already-stopped recogniser is not a failure worth
        // surfacing; whatever was heard is still delivered.
      }
    };

    return {
      ok: true,
      session: {
        stop: () =>
          new Promise<string>((resolve) => {
            if (finished) {
              resolve(heard);
              return;
            }
            resolveFinal = resolve;
            stopOnce();
            // A recogniser that never fires onend must not hang the control.
            setTimeout(finish, FINAL_RESULT_GRACE_MS);
          }),
        abort: () => {
          finish();
          stopOnce();
        },
      },
    };
  } catch (cause) {
    return { ok: false, detail: `Could not start on-device recognition (${String(cause)}).` };
  }
}

function errorDetail(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone was refused, so voice is unavailable. Typing works.';
    case 'audio-capture':
      return 'No microphone could be used, so voice is unavailable. Typing works.';
    case 'no-speech':
      return 'Nothing was heard.';
    default:
      return `Speech recognition failed${code === undefined ? '' : ` (${code})`}. Typing works.`;
  }
}

export async function probeOnDeviceRecognition(g: typeof globalThis = globalThis): Promise<VoiceProbeResult> {
  const ctor = speechRecognitionCtor(g);
  if (ctor === undefined) {
    return { availability: 'unavailable', detail: 'This browser has no speech recognition, so voice commands are unavailable. Typing works.' };
  }
  if (typeof ctor.available !== 'function' || ctor.prototype === undefined || !('processLocally' in ctor.prototype)) {
    // The browser has recognition but no on-device mode. Falling back to the
    // default would ship audio off the device (FR-043), so voice is refused.
    return {
      availability: 'unavailable',
      detail: 'This browser cannot recognise speech on the device, and this app will not send audio elsewhere. Typing works.',
    };
  }
  try {
    const status = await ctor.available({ langs: ['en-US'], processLocally: true });
    if (status === 'available') return { availability: 'available', detail: 'Voice is ready.' };
    if (status === 'downloadable' || status === 'downloading') {
      return { availability: 'downloadable', detail: 'Voice needs a one-off language download before it can work on this device.' };
    }
    return { availability: 'unavailable', detail: `On-device recognition reported "${status}". Typing works.` };
  } catch (cause) {
    // The probe is known to crash the renderer in headless Chrome. A refusal
    // path that takes the tab down with it is not a refusal path.
    return {
      availability: 'unavailable',
      detail: `Could not establish whether on-device recognition works (${String(cause)}). Voice is off; typing works.`,
    };
  }
}

export async function installLanguagePack(g: typeof globalThis = globalThis): Promise<VoiceProbeResult> {
  const ctor = speechRecognitionCtor(g);
  if (ctor === undefined || typeof ctor.install !== 'function') {
    return { availability: 'unavailable', detail: 'This browser cannot install an on-device language pack.' };
  }
  try {
    const installed = await ctor.install({ langs: ['en-US'] });
    return installed
      ? { availability: 'available', detail: 'Voice is ready.' }
      : { availability: 'downloadable', detail: 'The language download did not complete. Voice stays off until it does.' };
  } catch (cause) {
    return { availability: 'unavailable', detail: `The language download failed (${String(cause)}). Typing works.` };
  }
}
