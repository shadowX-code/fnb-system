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
 it.each([
  {stars:[],score:0,positiveTarget:0,quality:0},
  {stars:['FIVE'],score:6.5,positiveTarget:1.5,quality:5},
  {stars:['THREE'],score:5,positiveTarget:0,quality:5},
  {stars:['ONE'],score:0,positiveTarget:0,quality:0},
  {stars:['FIVE','FOUR','THREE','TWO'],score:3,positiveTarget:3,quality:0},
 ])('settles complete $stars evidence with the canonical 15+5 result',async({stars,score,positiveTarget,quality})=>{
  const input=fixture();
  input.snapshot.reviews=stars.map((starRating,i)=>({...fixture().snapshot.reviews[0],name:`${location}/reviews/${i}`,starRating}));
  input.snapshot.googleAggregate.totalReviewCount=stars.length;
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'settled',summary:{score,positiveTarget,quality}}]});
 });
 it('uses the verified scorer and sends only the three outcome numbers, not Google evidence',async()=>{
  const input=fixture();
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{period:'2026-10-01',status:'settled',summary:{score:9.5,positiveTarget:4.5,quality:5}}]});
  expect(input.settle).toHaveBeenLastCalledWith('2026-10-01',{...basis,fetchedAt:new Date(now).toISOString()},
   {score:9.5,positiveTarget:4.5,quality:5});
 });
 it('uses a frozen monthly outcome without reading the Google snapshot or submitting another score',async()=>{
  const input=fixture();input.settle.mockResolvedValueOnce({status:'ready',periods:['2026-10-01']})
   .mockResolvedValueOnce({status:'settled',changed:0,summary:{score:9.5}});
  Object.defineProperty(input,'snapshot',{get:()=>{throw new Error('Historical source must not be read');}});
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'settled',changed:0,summary:{score:9.5}}]});
  expect(input.settle).toHaveBeenCalledTimes(2);
 });
 it.each([
  {change:{snapshot:{...fixture().snapshot,googleAggregate:{totalReviewCount:5}}},reason:'incomplete_evidence'},
  {change:{snapshot:{...fixture().snapshot,fetchedAt:new Date(now-300000).toISOString()}},reason:'evidence_expired'},
  {change:{revision:'changed'},reason:'evidence_changed_or_expired'},
  {change:{generation:4},reason:'evidence_changed_or_expired'},
  {change:{location:'accounts/a/locations/other'},reason:'evidence_changed_or_expired'},
  {change:{snapshot:{...fixture().snapshot,reviews:[],googleAggregate:null}},reason:'incomplete_evidence'},
 ])('leaves $reason Pending without committing',async({change,reason})=>{
  const input={...fixture(),...change};
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'pending',reason}]});
  expect(input.settle).toHaveBeenCalledTimes(2);
 });
 it.each(['target_required','reconnect_required','mapping_required'])('retries %s on the next scheduled attempt rather than substituting zero',async(reason)=>{
  const input=fixture();input.settle.mockResolvedValueOnce({status:'ready',periods:['2026-10-01']})
   .mockResolvedValueOnce({status:'pending',reason});
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'pending',reason}]});
  expect(await settleCustomerMonths(input)).toMatchObject({results:[{status:'settled',summary:{score:9.5}}]});
 });
 it('retries older unresolved months and refuses a current-month settlement',async()=>{
  const input=fixture();input.settle.mockResolvedValueOnce({status:'ready',periods:['2026-09-01','2026-10-01','2026-11-01']});
  const result=await settleCustomerMonths(input);
  expect(result.results.map(r=>r.period)).toEqual(['2026-09-01','2026-10-01','2026-11-01']);
  expect(result.results[2]).toMatchObject({periodState:'provisional'});
  expect(result.results[0]).toMatchObject({status:'settled',summary:{score:0,positiveTarget:0,quality:0}});
  expect(input.settle.mock.calls.filter(call=>call[2]).map(call=>call[0])).toEqual(['2026-09-01','2026-10-01']);
 });
});
