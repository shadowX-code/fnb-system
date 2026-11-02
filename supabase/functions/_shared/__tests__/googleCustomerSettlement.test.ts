import { describe, expect, it, vi } from 'vitest';
import { settleCustomerMonths } from '../googleCustomerSettlement.ts';

const now = Date.parse('2026-11-01T00:00:00Z');
const location = 'accounts/a/locations/l';
const basis = { generation: 3, revision: 'mapping-1', location, target_revision: 1 };
function fixture() {
 const settle = vi.fn(async (period, supplied, customer) => period === null
  ? {status:'ready',periods:['2026-10-01']}
  : customer ? {status:'settled',summary:customer}
  : {status:'ready',target:10,basis});
 return {generation:3,revision:'mapping-1',location,now:()=>now,settle,
  snapshot:{googleAggregate:{totalReviewCount:4},fetchedAt:new Date(now).toISOString(),
   reviews:['FIVE','FOUR','FIVE','THREE'].map((starRating,i)=>({name:`${location}/reviews/${i}`,
    createTime:'2026-10-15T00:00:00Z',updateTime:'2026-10-15T00:00:00Z',starRating}))}};
}
describe('automatic monthly Customer settlement',()=>{
 it('uses the verified scorer and sends only the three outcome numbers, not Google evidence',async()=>{
  const input=fixture();
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{period:'2026-10-01',status:'settled',summary:{score:9.5,positiveTarget:4.5,quality:5}}]});
  expect(input.settle).toHaveBeenLastCalledWith('2026-10-01',{...basis,fetchedAt:new Date(now).toISOString()},
   {score:9.5,positiveTarget:4.5,quality:5});
 });
 it('preserves the hard retention guard without calculating or committing a Google score',async()=>{
  const input=fixture();input.settle.mockResolvedValue({status:'pending',reason:'google_retention_unresolved'});
  expect(await settleCustomerMonths(input)).toEqual({status:'pending',reason:'google_retention_unresolved'});
  expect(input.settle).toHaveBeenCalledExactlyOnceWith(null);
 });
 it.each([
  {change:{snapshot:{...fixture().snapshot,googleAggregate:{totalReviewCount:5}}},reason:'incomplete_evidence'},
  {change:{snapshot:{...fixture().snapshot,fetchedAt:new Date(now-300000).toISOString()}},reason:'evidence_expired'},
  {change:{revision:'changed'},reason:'evidence_changed_or_expired'},
 ])('leaves $reason Pending without committing',async({change,reason})=>{
  const input={...fixture(),...change};
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'pending',reason}]});
  expect(input.settle).toHaveBeenCalledTimes(2);
 });
 it('retries missing target on the next scheduled attempt rather than substituting zero',async()=>{
  const input=fixture();input.settle.mockResolvedValueOnce({status:'ready',periods:['2026-10-01']})
   .mockResolvedValueOnce({status:'pending',reason:'target_required'});
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'pending',reason:'target_required'}]});
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'settled',summary:{score:9.5}}]});
 });
 it('retries older unresolved months and refuses a current-month settlement',async()=>{
  const input=fixture();input.settle.mockResolvedValueOnce({status:'ready',periods:['2026-09-01','2026-10-01','2026-11-01']});
  const result=await settleCustomerMonths(input);
  expect(result.results.map(r=>r.period)).toEqual(['2026-09-01','2026-10-01','2026-11-01']);
  expect(result.results[2]).toMatchObject({periodState:'provisional'});
  expect(input.settle.mock.calls.filter(call=>call[2]).map(call=>call[0])).toEqual(['2026-10-01']);
 });
});
