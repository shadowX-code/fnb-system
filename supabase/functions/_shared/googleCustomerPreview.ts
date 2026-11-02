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
 if (!options.context.mapping?.location_resource_name) return pending('mapping_required');
 if (!Number.isSafeInteger(options.target) || options.target <= 0) return pending('target_required');
 // Current/future months cannot provide a complete monthly denominator.
 const [year, month] = options.period.split('-').map(Number);
 const closesAt = Date.UTC(year, month, 1) - 8 * 3600000;
 if (now() < closesAt) return pending('month_not_closed');
 const snapshot = await options.read();
 const fetched = Date.parse(snapshot.fetchedAt);
 if (!Number.isFinite(fetched) || fetched > now() || now() - fetched >= 300000) return pending('evidence_expired');
 if (!snapshot.googleAggregate || snapshot.googleAggregate.totalReviewCount !== snapshot.reviews.length) return pending('incomplete_evidence');
 const evidence = googleReviewMonthEvidence(snapshot.reviews, options.period);
 const result = previewGoogleCustomerScore(evidence, options.target);
 return { ...result, reason: 'reason' in result ? result.reason : undefined, persisted: false,
  period: options.period, target: options.target, total: evidence.total, positive: evidence.positive,
  negative: evidence.negative, negativeRate: evidence.negativeRate,
  fetchedAt: snapshot.fetchedAt, expiresAt: new Date(fetched + 300000).toISOString() };
}
