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

interface SpeechRecognitionStatic {
  available?: (opts: { langs: readonly string[]; processLocally: boolean }) => Promise<string>;
  install?: (opts: { langs: readonly string[] }) => Promise<boolean>;
  prototype?: object;
}

export function speechRecognitionCtor(g: typeof globalThis = globalThis): SpeechRecognitionStatic | undefined {
  const w = g as unknown as Record<string, unknown>;
  const ctor = w['SpeechRecognition'] ?? w['webkitSpeechRecognition'];
  return typeof ctor === 'function' ? (ctor as unknown as SpeechRecognitionStatic) : undefined;
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
