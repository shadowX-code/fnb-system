import {describe,it,expect,vi} from 'vitest';
import {latestPosts,metricAggregate,socialProjection,performanceBuckets,operationProjection} from '../dashboardProjection.js';
import {collectPages,dashboardService} from '../dashboardService.js';
import {marketingService} from '../marketingService.js';
const post=(patch={})=>({id:'1',brand_id:'b',channel:'instagram',connection_id:'c',provider_account_id:'a',provider_post_id:'p',published_at:'2026-10-10T20:00:00Z',observed_at:'2026-10-12T00:00:00Z',metrics:{views:10,interactions:0,reach:5},...patch});
describe('Social Analytics evidence projection',()=>{
 it('deduplicates repeated observations per exact account/channel/post and selects latest valid metric',()=>{
  const result=latestPosts([post(),post({id:'2',observed_at:'2026-10-13T00:00:00Z',metrics:{views:20}}),post({id:'3',provider_account_id:'other',metrics:{views:7}})]);
  expect(result).toHaveLength(2);expect(result[0].metrics).toMatchObject({views:20,interactions:0,reach:5});expect(result[0].metric_observations.interactions).toBe('2026-10-12T00:00:00Z');
 });
 it('resolves old missing account snapshot through exact historical evidence without merging unknown accounts',()=>{
  expect(latestPosts([post(),post({provider_account_id:null})])).toHaveLength(1);
  expect(latestPosts([post({provider_account_id:null,connection_generation:1}),post({provider_account_id:null,connection_generation:2})])).toHaveLength(2);
 });
 it('does not merge channels and preserves genuine zero versus unavailable',()=>{
  const r=socialProjection([post(),post({channel:'facebook',metrics:{views:0}})],'2026-10-11','2026-10-11');
  expect(r.posts).toHaveLength(2);expect(r.views).toEqual({value:10,available:2,total:2});expect(r.interactions).toEqual({value:0,available:1,total:2});expect(r.channels[0].interactions.value).toBeNull();expect(r).not.toHaveProperty('reach');
 });
 it('uses Malaysia-local publish dates, channels and no fabricated daily activity',()=>{
  expect(socialProjection([post()],'2026-10-10','2026-10-10').posts).toHaveLength(0);
  const r=socialProjection([post()],'2026-10-11','2026-10-12','instagram');
  expect(performanceBuckets(r.posts,'2026-10-11','2026-10-12')).toEqual([{date:'2026-10-11',published:1,views:10,interactions:0},{date:'2026-10-12',published:0,views:null,interactions:null}]);
 });
 it('does not sum Facebook interactions without complete evidence',()=>{
  expect(metricAggregate([post({channel:'facebook',metrics:{reactions:0,comments:2}})],'interactions').value).toBeNull();
  expect(metricAggregate([post({channel:'facebook',metrics:{reactions:0,comments:2,shares:0}})],'interactions').value).toBe(2);
 });
});
describe('Operational dashboard projection',()=>{
 it('excludes success receipts, answered/resolved/internal conversations and completed overdue tasks',()=>{
 const result=operationProjection({tasks:[{id:'t',brand_id:'b',status:'completed',due_date:'2026-10-01'},{id:'review',brand_id:'b',status:'in_review',due_date:'2026-10-13'}],content:[{key:'ok',status:'published',channels:[{job_state:'succeeded'}]},{key:'bad',brand_id:'b',status:'failed',channels:[{job_state:'failed'}]}],conversations:[{id:'answer',needs_reply:false},{id:'resolved',needs_reply:true,status:'resolved'},{id:'internal',needs_reply:true,channel:'internal'},{id:'reply',brand_id:'b',needs_reply:true,status:'open',channel:'instagram'}]},[{id:'b'}],'2026-10-13','2026-10-01');
 expect(result.actions.map(a=>a.key)).toEqual(['issue:bad','reply:reply','review:review']);expect(result.brandRows[0]).toMatchObject({due:1,reviews:1,issues:1,replies:1});
 });
 it('includes blockers without deadlines and shows unavailable source counts as null',()=>{
 const r=operationProjection({tasks:[{id:'blocked',blocked:true,status:'planned'}],content:null,conversations:null},[{id:'b'}],'2026-10-13','2026-10-01');expect(r.actions).toHaveLength(1);expect(r.brandRows[0].issues).toBeNull();expect(r.week.reviews).toBeNull();
 });
});
describe('Canonical page collection',()=>{
 it('loads all pages rather than presenting page totals as the full evidence',async()=>{
 const load=vi.fn().mockResolvedValueOnce({posts:[1],total:2}).mockResolvedValueOnce({posts:[2],total:2});expect((await collectPages(load,'posts','total',1)).posts).toEqual([1,2]);expect(load).toHaveBeenCalledTimes(2);
 });
 it('fails honestly if paging cannot deliver complete evidence',async()=>{
 const load=vi.fn().mockResolvedValueOnce({posts:[1],total:2}).mockResolvedValueOnce({posts:[],total:2});await expect(collectPages(load,'posts','total',1)).rejects.toThrow('complete report');
 });
 it('never invokes sources without their existing view permission',async()=>{
 const spy=vi.spyOn(marketingService,'contentManagement');const r=await dashboardService.operations('org','','2026-10-01',()=>false);expect(r.tasks).toBeNull();expect(r.unavailable).toHaveLength(3);expect(spy).not.toHaveBeenCalled();spy.mockRestore();
 });
});
