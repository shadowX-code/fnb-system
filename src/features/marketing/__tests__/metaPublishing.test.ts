import { describe,it,expect,vi } from 'vitest';
import { advanceMetaPublish,testAccountEnabled,verifyMetaMedia,MetaLedger } from '../../../../supabase/functions/_shared/metaPublishing.ts';
import { readMetaPosts } from '../../../../supabase/functions/_shared/metaSynchronization.ts';
import { MetaError } from '../../../../supabase/functions/_shared/metaGraph.ts';
const variant={channel:'facebook' as const,format:'carousel',caption:'Reviewed caption',asset_ids:['a','b']};
function harness(request:any=vi.fn()) {
 let ledger:MetaLedger={};const checkpoints:MetaLedger[]=[];
 const checkpoint=async(s:MetaLedger)=>{ledger=structuredClone(s);checkpoints.push(ledger);};const guard=vi.fn().mockResolvedValue(undefined);
 return {request,guard,checkpoints,run:(patch:any={})=>advanceMetaPublish({graph:{request,withWriteGuard:(authorize:any)=>({request:async(...args:any[])=>{await authorize();return request(...args)}})} as any,accountId:'111',token:'unit-token',variant,mediaUrls:['https://example.invalid/a','https://example.invalid/b'],state:ledger,checkpoint,guard,...patch}),getState:()=>ledger};
}
describe('durable Meta publishing',()=>{
 it('checkpoints unpublished Facebook uploads once and uses the actual feed receipt',async()=>{
  const h=harness(vi.fn().mockResolvedValueOnce({id:'901'}).mockResolvedValueOnce({id:'902'}).mockResolvedValueOnce({id:'111_903'}).mockResolvedValueOnce({id:'111_903'}));
  expect((await h.run()).outcome).toBe('waiting');expect((await h.run()).outcome).toBe('waiting');expect(await h.run()).toEqual({outcome:'published',postId:'111_903'});
  expect(await h.run()).toEqual({outcome:'published',postId:'111_903'});expect(h.request).toHaveBeenCalledTimes(4);
  expect(h.checkpoints[0].pending).toBe('photo_0');expect(h.request.mock.calls[0][2]).toEqual({url:'https://example.invalid/a',published:false});
  expect(h.request.mock.calls[2][2]).toEqual({message:'Reviewed caption',attached_media:[{media_fbid:'901'},{media_fbid:'902'}]});
  expect(JSON.stringify(h.getState())).not.toContain('https:');expect(JSON.stringify(h.getState())).not.toContain('unit-token');
 });
 it('never repeats a write whose response is uncertain, including a restarted worker',async()=>{
  const h=harness(vi.fn().mockRejectedValue(new MetaError('meta_response_uncertain',true)));
  expect((await h.run()).outcome).toBe('uncertain');expect((await h.run()).outcome).toBe('uncertain');expect(h.request).toHaveBeenCalledTimes(1);expect(h.getState().pending).toBe('photo_0');
 });
 it('retains uncertainty when persistence fails after Meta accepted a post',async()=>{
  let saved:MetaLedger={};const request=vi.fn().mockResolvedValue({id:'111_904'}),guard=vi.fn().mockResolvedValue(undefined);
  const checkpoint=async(s:MetaLedger)=>{if(s.post_id)throw new Error('db unavailable');saved=structuredClone(s);};
  const input={graph:{request,withWriteGuard:(authorize:any)=>({request:async(...args:any[])=>{await authorize();return request(...args)}})} as any,accountId:'111',token:'unit',variant:{...variant,format:'text',asset_ids:[]},mediaUrls:[],checkpoint,guard};
  expect((await advanceMetaPublish({...input,state:{}})).outcome).toBe('uncertain');
  expect((await advanceMetaPublish({...input,state:saved})).outcome).toBe('uncertain');expect(request).toHaveBeenCalledTimes(1);
 });
 it('polls Instagram processing across ticks and publishes only a finished container',async()=>{
  const h=harness(vi.fn().mockResolvedValueOnce({id:'801'}).mockResolvedValueOnce({status_code:'IN_PROGRESS'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'802'}));
  const patch={variant:{...variant,channel:'instagram',format:'reel',asset_ids:['v']},mediaUrls:['https://example.invalid/video']};
  expect((await h.run(patch)).outcome).toBe('waiting');expect((await h.run(patch)).outcome).toBe('waiting');expect(await h.run(patch)).toEqual({outcome:'published',postId:'802'});
  expect(h.request.mock.calls[0][2]).toMatchObject({media_type:'REELS',share_to_feed:true});expect(h.request.mock.calls[3][2]).toEqual({creation_id:'801'});
 });
 it('clears a definite rejected intent for bounded durable retry, and checks authority before sending',async()=>{
  const h=harness(vi.fn().mockRejectedValue(new MetaError('meta_error_4',false,true)));
  expect((await h.run()).outcome).toBe('retryable_failure');expect(h.getState().pending).toBeUndefined();
  h.guard.mockRejectedValue(new Error('scope revoked'));await h.run();expect(h.request).toHaveBeenCalledTimes(1);
 });
 it('reports definitive token rejection as permanent during Instagram processing, preserving the container',async()=>{
  const h=harness(vi.fn().mockResolvedValueOnce({id:'801'}).mockRejectedValueOnce(new MetaError('meta_permission_or_token_invalid',false,false,190)));
  const patch={variant:{...variant,channel:'instagram',format:'image',asset_ids:['a']},mediaUrls:['https://example.invalid/a']};
  expect((await h.run(patch)).outcome).toBe('waiting');
  expect(await h.run(patch)).toEqual({outcome:'permanent_failure',code:'meta_permission_or_token_invalid'});
  expect(h.getState().objects?.container).toBe('801');expect(h.getState().post_id).toBeUndefined();
  expect(h.request.mock.calls.filter(([, , , method])=>method==='POST')).toHaveLength(1);
 });
 it('keeps transient Instagram status reads retryable and token rejection on writes receipt-free',async()=>{
  const h=harness(vi.fn().mockResolvedValueOnce({id:'801'}).mockRejectedValueOnce(new MetaError('meta_error_4',false,true)));
  const patch={variant:{...variant,channel:'instagram',format:'image',asset_ids:['a']},mediaUrls:['https://example.invalid/a']};
  await h.run(patch);expect(await h.run(patch)).toEqual({outcome:'retryable_failure',code:'meta_error_4'});
  for(const channel of ['facebook','instagram']) {
   const rejected=harness(vi.fn().mockRejectedValue(new MetaError('meta_permission_or_token_invalid',false,false,190)));
   expect(await rejected.run({variant:{...variant,channel,format:channel==='facebook'?'text':'image',asset_ids:channel==='facebook'?[]:['a']},mediaUrls:channel==='facebook'?[]:['https://example.invalid/a']})).toEqual({outcome:'permanent_failure',code:'meta_permission_or_token_invalid'});
   expect(rejected.getState().pending).toBeUndefined();expect(rejected.getState().post_id).toBeUndefined();
  }
 });
 it('requires an exact explicit numeric test allowlist and validates actual media bytes',()=>{
  expect(testAccountEnabled('111','')).toBe(false);expect(testAccountEnabled('111','1111')).toBe(false);expect(testAccountEnabled('111','222, 111')).toBe(true);
  expect(()=>verifyMetaMedia(new TextEncoder().encode('not an image'),'image/jpeg','facebook')).toThrow('media_bytes_invalid');
  const jpeg=new Uint8Array([255,216,255,192,0,17,8,4,0,4,0,3,1,0,2,0,3,0,0,255,217]);
  expect(()=>verifyMetaMedia(jpeg,'image/jpeg','instagram')).not.toThrow();jpeg[10]=1;jpeg[9]=0;expect(()=>verifyMetaMedia(jpeg,'image/jpeg','instagram')).toThrow('instagram_image_dimensions_unsupported');
 });
});
describe('source-backed synchronization',()=>{
 it('preserves unavailable metrics and follows only validated Graph cursors',async()=>{
  const request=vi.fn().mockResolvedValueOnce({data:[{id:'801',caption:'Actual platform caption',timestamp:'2026-10-09T00:00:00Z',like_count:4,comments_count:0}],paging:{next:'https://untrusted.invalid/?token=secret',cursors:{after:'opaque-cursor'}}}).mockRejectedValue(new MetaError('meta_error_100',false,false,100));
  const result=await readMetaPosts({request} as any,{channel:'instagram',provider_account_id:'111',capabilities:{insights:true}},'unit',async()=>{});
  expect(result.after).toBe('opaque-cursor');expect(result.posts[0].metrics).toEqual({likes:4,comments:0});expect(result.posts[0].unavailable_metrics.reach).toBe('platform_metric_unavailable');expect(JSON.stringify(result)).not.toContain('secret');
 });
});

it('preserves mixed carousel order and waits for the video child before creating the parent',async()=>{
 const request=vi.fn().mockResolvedValueOnce({id:'901'}).mockResolvedValueOnce({id:'902'}).mockResolvedValueOnce({status_code:'IN_PROGRESS'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'903'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'904'}),h=harness(request);
 const patch={variant:{...variant,channel:'instagram',format:'carousel'},mediaTypes:['video/mp4','image/jpeg'],submissionGuard:vi.fn().mockResolvedValue(undefined)};
 for(let i=0;i<5;i++)expect((await h.run(patch)).outcome).toBe('waiting');
 expect(request.mock.calls[0][2]).toEqual({media_type:'VIDEO',video_url:'https://example.invalid/a',is_carousel_item:true});
 expect(request.mock.calls[4][2]).toEqual({media_type:'CAROUSEL',children:['901','902'],caption:variant.caption});
 expect(await h.run(patch)).toEqual({outcome:'published',postId:'904'});expect(JSON.stringify(h.getState())).not.toContain('https:');
});
it.each(['image/jpeg','video/mp4'])('creates a Story container without claiming caption/sticker support (%s)',async mime=>{
 const h=harness(vi.fn().mockResolvedValueOnce({id:'801'}));await h.run({variant:{...variant,channel:'instagram',format:'story',asset_ids:['a']},mediaUrls:['https://example.invalid/a'],mediaTypes:[mime],submissionGuard:vi.fn().mockResolvedValue(undefined)});
 expect(h.request.mock.calls[0][2]).toEqual({media_type:'STORIES',[mime==='video/mp4'?'video_url':'image_url']:'https://example.invalid/a'});
});
it('retains generic pending intent when authority fails after persistence, without a Meta write',async()=>{const h=harness();h.guard.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new MetaError('scope_changed'));expect((await h.run()).outcome).toBe('uncertain');expect(h.request).not.toHaveBeenCalled();expect(h.getState().pending).toBe('photo_0');});
