import {describe,it,expect,vi} from 'vitest';
import {latestPosts,metricAggregate,socialProjection,performanceBuckets,observationBuckets,rankSocialPosts,operationProjection} from '../dashboardProjection.js';
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
  expect(r.posts).toHaveLength(2);expect(r.views).toEqual({value:null,available:2,total:2,mixed_definitions:true});expect(r.interactions).toEqual({value:null,available:1,total:2,mixed_definitions:true});expect(r.channels[0].interactions.value).toBeNull();expect(r).not.toHaveProperty('reach');
 });
 it('uses Malaysia-local publish dates, channels and no fabricated daily activity',()=>{
  expect(socialProjection([post()],'2026-10-10','2026-10-10').posts).toHaveLength(0);
  const r=socialProjection([post()],'2026-10-11','2026-10-12','instagram');
  expect(performanceBuckets(r.posts,'2026-10-11','2026-10-12').map(({channels,...r})=>r)).toEqual([{date:'2026-10-11',published:1,views:10,interactions:0},{date:'2026-10-12',published:0,views:null,interactions:null}]);
 });
 it('retains every publication date as independent platform series instead of suppressing mixed days',()=>{
  const p=post({published_at:'2026-10-07T11:00:00Z'}),fb=post({channel:'facebook',provider_post_id:'fb',published_at:'2026-10-08T11:00:00Z',metrics:{views:178}}),ig=post({provider_post_id:'ig',published_at:'2026-10-08T11:00:00Z',metrics:{views:103,interactions:0}});
  const r=socialProjection([p,fb,ig],'2026-10-07','2026-10-09');const b=performanceBuckets(r.posts,'2026-10-07','2026-10-09');
  expect(b[1].views).toBeNull();expect(b[1].channels.facebook.views.value).toBe(178);expect(b[1].channels.instagram.views.value).toBe(103);expect(b[2].channels.instagram.views.value).toBeNull();
  expect(performanceBuckets(r.posts,'2026-10-07','2026-10-09','week')[0].channels.instagram.views.value).toBe(113);
 });
 it('never recycles metric evidence from an older credential generation',()=>{
  const r=latestPosts([post({connection_generation:1,metrics:{views:20,interactions:9}}),post({id:'new',connection_generation:2,observed_at:'2026-10-13T12:00:00Z',metrics:{views:0}})]);
  expect(r).toHaveLength(1);expect(r[0].metrics).toEqual({views:0});
 });
 it('keeps canonical snapshot gaps and zero, and uses ending totals rather than summing cumulative observations',()=>{
  const evidence={rows:[{ending:'2026-10-11',channel:'facebook',metric:'views',cumulative:20,growth:0,available_posts:1,paired_posts:1,observed_posts:2,cohort:'a'},{ending:'2026-10-12',channel:'facebook',metric:'views',cumulative:null,growth:null,available_posts:0,paired_posts:0,observed_posts:0}]};
  expect(observationBuckets(evidence,'views','growth').map(r=>r.channels.facebook.value)).toEqual([0,null]);
  expect(observationBuckets(evidence,'views','cumulative')[0].channels.facebook).toMatchObject({value:20,available:1,total:2,cohort:'a'});
 });
 it('ranks only available metrics in the requested channel with deterministic tie handling',()=>{
  const rows=latestPosts([post({provider_post_id:'zero',metrics:{views:0}}),post({provider_post_id:'missing',metrics:{}}),post({channel:'facebook',metrics:{views:99}})]);
  expect(rankSocialPosts(rows,'views','instagram').map(p=>p.provider_post_id)).toEqual(['zero']);
 });
 it('honors canonical provider interactions and their actual collection time',()=>{
  const p=post({channel:'facebook',metrics:{interactions:12,likes:10,reactions:11,shares:1},metric_provenance:{interactions:{source:'insights.post_activity_by_action_type',observed_at:'2026-10-11T00:00:00Z'}}});
  const r=latestPosts([p])[0];expect(r.metrics.interactions).toBe(12);expect(r.metric_observations.interactions).toBe('2026-10-11T00:00:00Z');expect(r.metric_provenance.interactions.source).toBe('insights.post_activity_by_action_type');
 });
 it('does not sum Facebook interactions without complete evidence',()=>{
  expect(metricAggregate([post({channel:'facebook',metrics:{reactions:0,comments:2}})],'interactions').value).toBeNull();
  expect(metricAggregate([post({channel:'facebook',metrics:{reactions:0,comments:2,shares:0}})],'interactions').value).toBe(2);
 });
 it('retains detail-only provider metrics and provenance without aggregating unique viewers',()=>{
  const evidence={source:'insights.post_total_media_view_unique',period:'lifetime',observed_at:'2026-10-13T01:43:00Z',graph_version:'v26.0'};
  const fb=post({channel:'facebook',metrics:{views:19,viewers:3},metric_provenance:{viewers:evidence}});
  const ig=post({channel:'instagram',metrics:{views:0,watch_time_ms:2500,avg_watch_time_ms:0}});
  const r=latestPosts([fb,ig]);
  expect(r[0].metrics).toEqual({views:19,viewers:3});
  expect(r[0].metric_provenance.viewers).toEqual(evidence);expect(r[0].metric_observations.viewers).toBe(evidence.observed_at);
  expect(r[1].metrics).toMatchObject({watch_time_ms:2500,avg_watch_time_ms:0});
  expect(metricAggregate(r,'viewers')).toEqual({value:null,available:1,total:2});
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
