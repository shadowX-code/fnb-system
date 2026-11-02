import { customerPerformancePreview } from './googleCustomerPreview.ts';
import type { GoogleReviewRecord } from './googleReviewsContract.ts';

// Uses the existing complete GET snapshot, scorer and Performance authority.
// Frozen monthly outcomes return before any source classification or recalculation.
export async function settleCustomerMonths(options: {
  snapshot: { reviews: GoogleReviewRecord[]; googleAggregate: any; fetchedAt: string };
  generation: number; revision: string; location: string;
  settle: (period: string | null, basis?: any, customer?: any) => Promise<any>;
  now?: () => number;
}) {
  const now = options.now || Date.now;
  const pending = await options.settle(null);
  if (pending.status !== 'ready') return pending;
  const results = [];
  for (const period of pending.periods) results.push({ period, ...await settleMonth(period) });
  return { results };
  async function settleMonth(period: string) {
  const context = await options.settle(period);
  if (context.status !== 'ready') return context;
  if (context.basis.generation !== options.generation || context.basis.revision !== options.revision
    || context.basis.location !== options.location) return { status: 'pending', reason: 'evidence_changed_or_expired' };
  const result = await customerPerformancePreview({ period, target: context.target, now,
    context: { can_sync: true, connection_status: 'connected', mapping: { name: options.location } },
    read: async () => options.snapshot });
  if (result.status !== 'preview_only' || result.periodState !== 'closed_month') return result;
  return options.settle(period, { ...context.basis, fetchedAt: result.fetchedAt },
    { score: result.score, positiveTarget: result.positiveTarget, quality: result.quality });
  }
}
