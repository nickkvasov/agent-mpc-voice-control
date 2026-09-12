import type { QuotaView } from './client.ts';

/**
 * FR-022: quota is a daily condition to be shown, not an error to be hidden.
 * `null` is displayed as not-known rather than as zero.
 */
export function QuotaIndicator({ quota }: { readonly quota: QuotaView }) {
  const remaining = quota.searchCallsRemaining;
  return (
    <p data-testid="quota" style={{ fontSize: '0.85rem', color: '#555' }}>
      {remaining === null
        ? 'Searches remaining today: not known yet.'
        : `Searches remaining today: ${String(remaining)} (shared by everyone using this app).`}
      {remaining !== null && remaining === 0 ? ' Filtering what is already loaded still works.' : ''}
    </p>
  );
}
