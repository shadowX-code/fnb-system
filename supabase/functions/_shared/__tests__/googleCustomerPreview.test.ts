import { describe, expect, it, vi } from 'vitest';
import { customerPerformancePreview } from '../googleCustomerPreview.ts';

const now = Date.parse('2026-11-02T00:00:00Z');
const location = 'accounts/a/locations/l';
const context = { can_sync: true, connection_status: 'connected', mapping: { name: location, revision: "mapped-revision" } };
const reviews = ['FIVE', 'FOUR', 'THREE', 'ONE'].map((starRating, i) => ({ name: `${location}/reviews/${i}`, createTime: '2026-10-15T00:00:00Z', updateTime: '2026-10-15T00:00:00Z', starRating }));
const options = () => ({ period: '2026-10-01', context, target: 4, now: () => now, read: vi.fn().mockResolvedValue({ reviews, googleAggregate: { totalReviewCount: 4 }, fetchedAt: new Date(now).toISOString() }) });

describe('non-persistent Customer preview', () => {
 it('reuses the 15+5 model with neutral denominator and no employee attribution', async () => {
  const input = options();
  expect(await customerPerformancePreview(input)).toMatchObject({ status: 'preview_only', score: 7.5, positiveTarget: 7.5, quality: 0, total: 4, positive: 2, negative: 1, negativeRate: 0.25, persisted: false });
  expect(input.read).toHaveBeenCalledTimes(1);
 });
 it.each([
  { context: { ...context, connection_status: 'expired' }, reason: 'reconnect_required' },
  { context: { ...context, mapping: null }, reason: 'mapping_required' },
  { target: 0, reason: 'target_required' },
  { period: '2026-11-01', reason: 'month_not_closed' },
 ])('does not fetch with insufficient prerequisites: $reason', async ({ reason, ...change }) => {
  const input = { ...options(), ...change };
  expect(await customerPerformancePreview(input)).toMatchObject({ status: 'pending', score: null, reason });
  expect(input.read).not.toHaveBeenCalled();
 });
 it('rejects missing Sync authority before any provider access', async () => {
  const input = { ...options(), context: { ...context, can_sync: false } };
  await expect(customerPerformancePreview(input)).rejects.toThrow('permission');
  expect(input.read).not.toHaveBeenCalled();
 });
 it.each([
  { fetchedAt: new Date(now - 300000).toISOString(), reason: 'evidence_expired' },
  { googleAggregate: { totalReviewCount: 5 }, reason: 'incomplete_evidence' },
  { googleAggregate: null, reason: 'incomplete_evidence' },
 ])('keeps expired/incomplete evidence Pending: $reason', async ({ reason, ...change }) => {
  const input = options(); input.read.mockResolvedValue({ reviews, googleAggregate: { totalReviewCount: 4 }, fetchedAt: new Date(now).toISOString(), ...change });
  expect(await customerPerformancePreview(input)).toMatchObject({ status: 'pending', score: null, reason });
 });
 it('keeps complete empty evidence Pending and propagates read failures instead of assuming zero', async () => {
  const input = options(); input.read.mockResolvedValue({ reviews: [], googleAggregate: { totalReviewCount: 0 }, fetchedAt: new Date(now).toISOString() });
  expect(await customerPerformancePreview(input)).toMatchObject({ status: 'pending', score: null, reason: 'no_eligible_reviews' });
  input.read.mockRejectedValue(new Error('Google read failed'));
  await expect(customerPerformancePreview(input)).rejects.toThrow('Google read failed');
 });
 it('waits until the Malaysia month boundary, including short months', async () => {
  const input = { ...options(), period: '2026-02-01', now: () => Date.parse('2026-02-28T15:59:59Z') };
  expect(await customerPerformancePreview(input)).toMatchObject({ reason: 'month_not_closed' });
 });
});
