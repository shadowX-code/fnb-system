import { describe, expect, it, vi } from 'vitest';
import { assertCustomerPreviewBasis, customerPerformancePreview } from '../googleCustomerPreview.ts';

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
  { period: '2026-12-01', reason: 'period_not_started' },
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
 it('marks a complete current-month read provisional, and the same month closed after Malaysia midnight', async () => {
  const input = {...options(),period:'2026-02-01'};
  for (const [time,periodState] of [['2026-02-28T15:59:59Z','provisional'],['2026-02-28T16:00:00Z','closed_month']]) {
   input.now = () => Date.parse(time);
   input.read.mockResolvedValue({reviews:[],googleAggregate:{totalReviewCount:0},fetchedAt:time});
   expect(await customerPerformancePreview(input)).toMatchObject({periodState,status:'pending',score:null});
  }
 });
 it('calculates the current month with the unchanged scorer without adding points to a stored total', async () => {
  const input = {...options(),period:'2026-11-01',target:10};
  input.read.mockResolvedValue({reviews:[{...reviews[0],createTime:'2026-11-01T00:00:00Z',updateTime:'2026-11-01T00:00:00Z'}],googleAggregate:{totalReviewCount:1},fetchedAt:new Date(now).toISOString()});
  expect(await customerPerformancePreview(input)).toMatchObject({periodState:'provisional',positiveTarget:1.5,quality:5,score:6.5,persisted:false});
 });
});

describe('preview basis revalidation', () => {
 const basis = {...context,generation:1}, target = {positive_target:10,target_revision:1};
 it.each([
  [{...basis,generation:2},target],
  [{...basis,mapping:{...basis.mapping,revision:'changed'}},target],
  [{...basis,mapping:{...basis.mapping,name:'accounts/a/locations/other'}},target],
  [{...basis,can_sync:false},target],
  [basis,{positive_target:20,target_revision:2}],
  [basis,{positive_target:10,target_revision:3}],
 ])('rejects mapping/access changes and target changes restored to their old value', (latest,latestTarget) => {
  expect(() => assertCustomerPreviewBasis(basis,latest,target,latestTarget)).toThrow('changed');
 });
 it('accepts the unchanged outlet/month basis', () => {
  expect(() => assertCustomerPreviewBasis(basis,basis,target,target)).not.toThrow();
 });
});
