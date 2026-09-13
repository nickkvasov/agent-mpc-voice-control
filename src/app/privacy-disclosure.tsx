/**
 * FR-045: what leaves the device is stated, not left to be inferred.
 *
 * This exists because the opposite would be a true statement implying a false
 * one. Speech is recognised on the device and audio never leaves it — but the
 * assistant runs elsewhere, so the TEXT does. Saying only the first half would
 * read as a promise that nothing is transmitted (Constitution VII).
 */
export interface PrivacyDisclosureProps {
  readonly voiceAvailable: boolean;
  readonly assistantConnected: boolean;
}

export function PrivacyDisclosure({ voiceAvailable, assistantConnected }: PrivacyDisclosureProps) {
  return (
    <section data-testid="privacy" style={{ fontSize: '0.85rem', color: '#555', borderTop: '1px solid #ddd', marginTop: '1rem', paddingTop: '0.5rem' }}>
      <h2 style={{ fontSize: '0.9rem', margin: '0 0 0.25rem' }}>What leaves this device</h2>
      <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
        <li data-testid="privacy-audio">
          {voiceAvailable
            ? 'Your voice is recognised on this device. The audio itself is never sent anywhere.'
            : 'Voice is off, so no audio is captured at all.'}
        </li>
        <li data-testid="privacy-text">
          {assistantConnected
            ? 'What you say or type — and the titles of videos it acts on — is sent to an external language model service so the assistant can understand it.'
            : 'The assistant is not connected, so nothing is sent to a language model service. Commands are handled on this device or refused.'}
        </li>
        <li data-testid="privacy-catalog">
          Searches are sent to YouTube. This app has no account and stores your collections, tags and labels only on this device.
        </li>
      </ul>
    </section>
  );
}
