import {describe,it,expect,vi} from 'vitest';
import { readMetaPosts, facebookPostFields } from '../../../../supabase/functions/_shared/metaSynchronization.ts';
import { MetaError } from '../../../../supabase/functions/_shared/metaGraph.ts';
const connection={channel:'facebook',provider_account_id:'111',capabilities:{granted_scopes:['pages_read_engagement','pages_read_user_content']}};
const page={data:[{id:'111_222',message:'Page content',created_time:'2026-10-09T00:00:00Z',shares:{count:2}}]};
describe('Facebook optional engagement evidence',()=>{
 it('preserves authorized Page posts and missing metric provenance when protected engagement is denied',async()=>{
  const request=vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(new MetaError('meta_permission_or_token_invalid',false,false,10)).mockRejectedValueOnce(new MetaError('platform_rejected',false,false,100)).mockRejectedValueOnce(new MetaError('meta_permission_or_token_invalid',false,false,200)).mockResolvedValueOnce({});
  const guard=vi.fn(),result=await readMetaPosts({request} as any,connection,'token',guard);
  expect(request.mock.calls[0][2].fields).toBe(facebookPostFields);expect(facebookPostFields).not.toMatch(/likes|comments/);
  expect(request).toHaveBeenCalledTimes(5);expect(guard).toHaveBeenCalledTimes(5);
  expect(result.posts[0]).toMatchObject({id:'111_222',metrics:{shares:2},unavailable_metrics:{likes:'platform_permission_unavailable',comments:'platform_permission_unavailable'}});
  expect(result.posts[0].metrics).not.toHaveProperty('likes');expect(result.posts[0].metrics).not.toHaveProperty('comments');
 });
 it('retains provider thumbnails only from recognized public media hosts without token material',async()=>{
  for(const [candidate,expected] of [['https://scontent.test.fbcdn.net/a.jpg','https://scontent.test.fbcdn.net/a.jpg'],['https://example.com/a.jpg',null],['https://scontent.fbcdn.net/a.jpg?access_token=secret',null]]){
   const request=vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({likes:{summary:{total_count:0}}}).mockResolvedValueOnce({reactions:{summary:{total_count:0}}}).mockResolvedValueOnce({comments:{summary:{total_count:0}}}).mockResolvedValueOnce({full_picture:candidate});
   expect((await readMetaPosts({request} as any,connection,'token',vi.fn())).posts[0].thumbnail_url).toBe(expected);
  }
 });
 it('still stops on invalid or expired credentials and revoked authority',async()=>{
  for(const error of [new MetaError('meta_permission_or_token_invalid',false,false,190),new MetaError('meta_permission_or_token_invalid'),new Error('authority changed')]) {
   const request=vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(error);
   await expect(readMetaPosts({request} as any,connection,'token',vi.fn())).rejects.toBe(error);
  }
  const request=vi.fn().mockResolvedValueOnce(page),guard=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('scope revoked'));
  await expect(readMetaPosts({request} as any,connection,'token',guard)).rejects.toThrow('scope revoked');expect(request).toHaveBeenCalledTimes(1);
 });
 it('retains actual available metrics and never replaces unsupported values with zero',async()=>{
  const request=vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce({likes:{summary:{total_count:3}}}).mockResolvedValueOnce({reactions:{summary:{total_count:1}}}).mockResolvedValueOnce({}).mockResolvedValueOnce({full_picture:'https://scontent.test.fbcdn.net/preview.jpg'});
  expect((await readMetaPosts({request} as any,connection,'token',vi.fn())).posts[0].metrics).toEqual({shares:2,likes:3,reactions:1});
 });
});

describe('isolated platform metrics and media',()=>{
 it('retains core Instagram posts when each optional insight is denied and never invents zero',async()=>{
  const request=vi.fn().mockImplementation(async(path,token,params)=>{
   if(path==='111/media')return {data:[{id:'222',caption:'Real',timestamp:'2026-10-11T00:00:00Z',like_count:0,comments_count:0}]};
   if(path==='222')return {media_type:'IMAGE',media_product_type:'FEED',media_url:'https://scontent.cdninstagram.com/a.jpg'};
   if(params.metric==='reach')return {data:[{name:'reach',values:[{value:0}]}]};
   if(params.metric==='views')throw new MetaError('meta_permission_or_token_invalid',false,false,10);
   return {data:[]};
  });
  const {posts}=await readMetaPosts({request} as any,{channel:'instagram',provider_account_id:'111',capabilities:{insights:true}},'test',async()=>{});
  expect(posts[0].metrics).toEqual({likes:0,comments:0,reach:0});expect(posts[0].unavailable_metrics.views).toBe('platform_permission_unavailable');expect(posts[0].unavailable_metrics.saves).toBe('not_returned');expect(posts[0].media).toEqual([{type:'image',url:'https://scontent.cdninstagram.com/a.jpg',thumbnail_url:null}]);
 });
 it('requests only media-specific Reels watch time and accepts actual per-metric evidence',async()=>{
  const request=vi.fn().mockImplementation(async(path,token,params)=>path==='111/media'?{data:[{id:'222',timestamp:'2026-10-11T00:00:00Z'}]}:path==='222'?{media_type:'VIDEO',media_product_type:'REELS',media_url:'https://scontent.cdninstagram.com/a.mp4',thumbnail_url:'https://scontent.cdninstagram.com/a.jpg'}:{data:[{name:params.metric,total_value:{value:5}}]});
  const {posts}=await readMetaPosts({request} as any,{channel:'instagram',provider_account_id:'111',capabilities:{insights:true}},'test',async()=>{});
  expect(posts[0].metrics).toMatchObject({saves:5,shares:5,interactions:5,watch_time_ms:5,avg_watch_time_ms:5});expect(posts[0].media[0].type).toBe('video');
 });
 it('uses current Facebook views without relabelling unique viewers as reach',async()=>{
  const request=vi.fn().mockImplementation(async(path,token,params)=>path==='111/posts'?page:params.metric?{data:[{name:params.metric,values:[{value:0}]}]}:{});
  const {posts}=await readMetaPosts({request} as any,{...connection,capabilities:{granted_scopes:['read_insights','pages_read_engagement']}},'test',async()=>{});
  expect(posts[0].metrics).toMatchObject({views:0,viewers:0});expect(posts[0].metrics).not.toHaveProperty('reach');expect(posts[0].unavailable_metrics.reach).toBe('not_supported');
 });
});


describe('Facebook aggregate Insights without protected person edges',()=>{
 const fb={channel:'facebook',provider_account_id:'111',capabilities:{granted_scopes:['read_insights','pages_read_engagement']}};
 const provider=(reactions:any,actions:any)=>({version:'v25.0',request:vi.fn().mockImplementation(async(path:string,_token:string,params:any)=>{
  if(path==='111/posts')return page;
  if(params.metric)return {data:[{name:params.metric,period:'lifetime',values:[{value:params.metric==='post_reactions_by_type_total'?reactions:params.metric==='post_activity_by_action_type'?actions:0}]}]};
  return {};
 })});
 it('uses real reaction/action maps, does not double count LIKE, and keeps sparse components unavailable',async()=>{
  const graph=provider({like:10,love:1},{like:11,share:1});
  const {posts}=await readMetaPosts(graph as any,fb,'token',async()=>{});
  expect(posts[0].metrics).toMatchObject({likes:10,reactions:11,interactions:12,views:0,shares:2});
  expect(posts[0].metrics).not.toHaveProperty('comments');expect(posts[0].metrics).not.toHaveProperty('reach');
  expect(posts[0].metric_provenance.interactions).toMatchObject({source:'insights.post_activity_by_action_type',period:'lifetime',graph_version:'v25.0'});
  expect(Date.parse(posts[0].metric_provenance.interactions.observed_at)).toBeGreaterThan(0);
  expect(graph.request.mock.calls.some(call=>/^(reactions|comments)/.test(call[2].fields||''))).toBe(false);
 });
 it('preserves explicit zero, comments and share fallback with exact provider provenance',async()=>{
  const graph=provider({like:0,love:0},{like:0,comment:0,share:0});
  graph.request.mockImplementation(async(path:string,_token:string,params:any)=>path==='111/posts'?{data:[{id:'111_222'}]}:params.metric?{data:[{name:params.metric,period:'lifetime',values:[{value:params.metric==='post_reactions_by_type_total'?{like:0,love:0}:params.metric==='post_activity_by_action_type'?{like:0,comment:0,share:0}:0}]}]}:{});
  const {posts}=await readMetaPosts(graph as any,fb,'token',async()=>{});
  expect(posts[0].metrics).toMatchObject({likes:0,reactions:0,comments:0,shares:0,interactions:0});expect(posts[0].unavailable_metrics).not.toHaveProperty('comments');
 });
 it('does not turn empty, malformed or incompatible breakdowns into evidence',async()=>{
  for(const invalid of [{},{like:'2'},{like:-1},{like:2,click:9},[]]){
   const {posts}=await readMetaPosts(provider(invalid,invalid) as any,fb,'token',async()=>{});
   expect(posts[0].metrics).not.toHaveProperty('likes');expect(posts[0].metrics).not.toHaveProperty('interactions');
  }
 });
 it('isolates optional Insights denials but stops on expired authorization and revocation',async()=>{
  for(const code of [10,100,190]){
   const graph=provider({},{});graph.request.mockImplementation(async(path:string,_token:string,params:any)=>path==='111/posts'?page:params.metric?Promise.reject(new MetaError(code===100?'meta_error_100':'meta_permission_or_token_invalid',false,false,code)):{});
   if(code===190)await expect(readMetaPosts(graph as any,fb,'token',async()=>{})).rejects.toMatchObject({graphCode:190});
   else expect((await readMetaPosts(graph as any,fb,'token',async()=>{})).posts[0].metrics).toEqual({shares:2});
  }
 });
});
