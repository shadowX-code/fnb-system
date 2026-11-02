import { googleReviewMonthEvidence, previewGoogleCustomerScore } from './googleReviewsContract.ts';
import type { GoogleReviewRecord } from './googleReviewsContract.ts';

// Request-local only: never reads the stored review cache or writes Performance.
export async function customerPerformancePreview(options: {
 period: string; context: any; target: number;
 read: () => Promise<{ reviews: GoogleReviewRecord[]; googleAggregate: any; fetchedAt: string }>;
 now?: () => number;
}) {
 const now = options.now || Date.now;
 const pending = (reason: string) => ({ status: 'pending', score: null, reason, persisted: false });
 if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(options.period)) throw new Error('Choose a Performance month.');
 if (!options.context.can_sync) throw new Error('Google Reviews Sync permission is required to prepare a fresh preview.');
 if (options.context.connection_status !== 'connected') return pending('reconnect_required');
 if (!options.context.mapping?.name) return pending('mapping_required');
 if (!Number.isSafeInteger(options.target) || options.target <= 0) return pending('target_required');
 // A complete source walk supports a month-to-date preview, never a finalized snapshot.
 const [year, month] = options.period.split('-').map(Number);
 const closesAt = Date.UTC(year, month, 1) - 8 * 3600000;
 const startsAt = Date.UTC(year, month - 1, 1) - 8 * 3600000;
 if (now() < startsAt) return pending('period_not_started');
 const snapshot = await options.read();
 const fetched = Date.parse(snapshot.fetchedAt);
 if (!Number.isFinite(fetched) || fetched > now() || now() - fetched >= 300000) return pending('evidence_expired');
 const periodState = fetched < closesAt ? 'provisional' : 'closed_month';
 if (!snapshot.googleAggregate || snapshot.googleAggregate.totalReviewCount !== snapshot.reviews.length) return pending('incomplete_evidence');
 const evidence = googleReviewMonthEvidence(snapshot.reviews, options.period);
 const result = previewGoogleCustomerScore(evidence, options.target);
 return { ...result, reason: 'reason' in result ? result.reason : undefined, persisted: false,
  period: options.period, periodState, target: options.target, total: evidence.total, positive: evidence.positive,
  negative: evidence.negative, negativeRate: evidence.negativeRate,
  fetchedAt: snapshot.fetchedAt, expiresAt: new Date(fetched + 300000).toISOString() };
}


export function assertCustomerPreviewBasis(initial: any, latest: any, target: any, latestTarget: any) {
 if (!latest.can_sync || latest.connection_status !== 'connected'
  || initial.generation !== latest.generation || initial.mapping?.name !== latest.mapping?.name
  || initial.mapping?.revision !== latest.mapping?.revision
  || target.positive_target !== latestTarget.positive_target || target.target_revision !== latestTarget.target_revision)
  throw new Error('Access, outlet mapping or monthly target changed. Refresh the preview.');
}
