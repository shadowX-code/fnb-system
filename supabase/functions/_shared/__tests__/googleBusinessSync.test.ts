import {describe,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {seal,unseal} from '../metaSecurity.ts';
import {BusinessProfileError} from '../googleBusinessProfile.ts';
import {synchronizeBusinessReviews,runScheduledReviewSync,businessTokenBinding,businessInboxBinding} from '../googleBusinessSync.ts';
vi.stubGlobal('crypto',webcrypto);
const key=btoa('x'.repeat(32)),location='accounts/qa/locations/a';
const review=(id:string)=>({reviewId:id,createTime:'2026-05-15T00:00:00Z',updateTime:'2026-05-15T00:00:00Z',starRating:'FIVE',reviewReply:{comment:'Existing remote reply',updateTime:'2026-05-16T00:00:00Z'}});
async function fixture(expired=false){
 const material={generation:2,mapping:{outlet_id:'outlet-a',location_resource_name:location,revision:'rev-a'},expires_at:new Date(Date.now()+(expired?-1:3600)*1000).toISOString(),sealed_token:await seal({access_token:'fixture',refresh_token:'fixture-refresh'},key,businessTokenBinding(2))};
 const call=vi.fn(async(action:string)=>action==='material'?material:action==='sync_begin'?{lease:'lease-a'}:{ok:true,updated:true});
 const grant=vi.fn(async()=>({access_token:'refreshed-fixture',expires_in:3600}));
 return {material,call,grant,key,keys:[key]};
}
describe('shared review sync',()=>{
 it('refreshes, walks all pages, deduplicates and retains remote owner replies without Google writes',async()=>{
  const f=await fixture(true);const transport=vi.fn(async(_url:any,init:any)=>{expect(init.method).toBe('GET');return Response.json(transport.mock.calls.length===1?{reviews:[review('a')],nextPageToken:'p2',totalReviewCount:2,averageRating:5}:{reviews:[review('a'),review('b')],totalReviewCount:2,averageRating:5});});
  await synchronizeBusinessReviews({...f,transport});expect(f.grant).toHaveBeenCalledTimes(1);expect(transport).toHaveBeenCalledTimes(2);
  const finish=f.call.mock.calls.find(c=>c[0]==='sync_finish') as any;
  const saved=await unseal(finish[1].sealed_reviews,[key],businessInboxBinding(2,f.material.mapping));
  expect(saved.reviews).toHaveLength(2);expect(saved.reviews[1].reviewReply.comment).toBe('Existing remote reply');expect(saved.googleAggregate.totalReviewCount).toBe(2);
 });
 it('does not commit partial page walks and records exact 429 evidence',async()=>{
  const f=await fixture();const transport=vi.fn(async()=>new Response('',{status:429}));
  await expect(synchronizeBusinessReviews({...f,transport})).rejects.toMatchObject({code:'google_rate_limited'});
  expect(f.call.mock.calls.some(c=>c[0]==='sync_finish')).toBe(false);
  expect(f.call).toHaveBeenCalledWith('sync_error',expect.objectContaining({error_code:'google_rate_limited',error_service:'mybusiness.googleapis.com',error_request:`GET /v4/${location}/reviews`}));
 });
 it('rejects an obsolete generation at commit without retrying writes',async()=>{
  const f=await fixture();f.call.mockImplementation(async(action:string)=>{if(action==='sync_finish')throw new BusinessProfileError('sync_authority_changed',409);return action==='material'?f.material:{lease:'lease-a'};});
  await expect(synchronizeBusinessReviews({...f,transport:async()=>Response.json({reviews:[]})})).rejects.toMatchObject({code:'sync_authority_changed'});expect(f.call.mock.calls.filter(c=>c[0]==='sync_finish')).toHaveLength(1);
 });
});
describe('scheduled sync pacing',()=>{
 it('syncs each mapped outlet sequentially with at most one transient retry',async()=>{
  const attempts:string[]=[];let busy=false;const sync=vi.fn(async(id:string)=>{expect(busy).toBe(false);busy=true;attempts.push(id);busy=false;if(attempts.length===1)throw new BusinessProfileError('google_unavailable',503);});const sleep=vi.fn(async()=>{});
  expect(await runScheduledReviewSync(['a','b'],sync,{sleep})).toEqual({succeeded:2,failed:0,stopped:''});expect(attempts).toEqual(['a','a','b']);expect(sleep).toHaveBeenCalledTimes(1);
 });
 it.each(['google_rate_limited','reconnect_required'])('halts without retry or further locations on %s',async(code)=>{
  const sync=vi.fn(async()=>{throw new BusinessProfileError(code,429);}),sleep=vi.fn(async()=>{});
  expect(await runScheduledReviewSync(['a','b'],sync,{sleep})).toEqual({succeeded:0,failed:1,stopped:code});expect(sync).toHaveBeenCalledTimes(1);expect(sleep).not.toHaveBeenCalled();
 });
 it('bounds retries and the run deadline',async()=>{
  const sync=vi.fn(async()=>{throw new BusinessProfileError('google_unavailable',503);});expect((await runScheduledReviewSync(['a'],sync,{sleep:async()=>{}})).failed).toBe(1);expect(sync).toHaveBeenCalledTimes(2);
  sync.mockClear();expect((await runScheduledReviewSync(['a'],sync,{now:()=>100,deadline:101})).stopped).toBe('time_budget');expect(sync).not.toHaveBeenCalled();
 });
});
