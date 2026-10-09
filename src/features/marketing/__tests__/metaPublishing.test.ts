import { describe,it,expect,vi } from 'vitest';
import { advanceMetaPublish,testAccountEnabled,verifyMetaMedia,MetaLedger } from '../../../../supabase/functions/_shared/metaPublishing.ts';
import { readMetaPosts } from '../../../../supabase/functions/_shared/metaSynchronization.ts';
import { MetaError } from '../../../../supabase/functions/_shared/metaGraph.ts';
const variant={channel:'facebook' as const,format:'carousel',caption:'Reviewed caption',asset_ids:['a','b']};
function harness(request:any=vi.fn()) {
 let ledger:MetaLedger={};const checkpoints:MetaLedger[]=[];
 const checkpoint=async(s:MetaLedger)=>{ledger=structuredClone(s);checkpoints.push(ledger);};const guard=vi.fn().mockResolvedValue(undefined);
 return {request,guard,checkpoints,run:(patch:any={})=>advanceMetaPublish({graph:{request} as any,accountId:'111',token:'unit-token',variant,mediaUrls:['https://example.invalid/a','https://example.invalid/b'],state:ledger,checkpoint,guard,...patch}),getState:()=>ledger};
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
  const input={graph:{request} as any,accountId:'111',token:'unit',variant:{...variant,format:'text',asset_ids:[]},mediaUrls:[],checkpoint,guard};
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
 it('requires an exact explicit numeric test allowlist and validates actual media bytes',()=>{
  expect(testAccountEnabled('111','')).toBe(false);expect(testAccountEnabled('111','1111')).toBe(false);expect(testAccountEnabled('111','222, 111')).toBe(true);
  expect(()=>verifyMetaMedia(new TextEncoder().encode('not an image'),'image/jpeg','facebook')).toThrow('media_bytes_invalid');
  const jpeg=new Uint8Array([255,216,255,192,0,17,8,4,0,4,0,3,1,0,2,0,3,0,0,255,217]);
  expect(()=>verifyMetaMedia(jpeg,'image/jpeg','instagram')).not.toThrow();jpeg[10]=1;jpeg[9]=0;expect(()=>verifyMetaMedia(jpeg,'image/jpeg','instagram')).toThrow('instagram_image_dimensions_unsupported');
 });
});
describe('source-backed synchronization',()=>{
 it('preserves unavailable metrics and follows only validated Graph cursors',async()=>{
  const request=vi.fn().mockResolvedValueOnce({data:[{id:'801',caption:'Actual platform caption',timestamp:'2026-10-09T00:00:00Z',like_count:4,comments_count:0}],paging:{next:'https://untrusted.invalid/?token=secret',cursors:{after:'opaque-cursor'}}}).mockRejectedValueOnce(new MetaError('meta_error_100'));
  const result=await readMetaPosts({request} as any,{channel:'instagram',provider_account_id:'111',capabilities:{insights:true}},'unit',async()=>{});
  expect(result.after).toBe('opaque-cursor');expect(result.posts[0].metrics).toEqual({likes:4,comments:0});expect(result.posts[0].unavailable_metrics.reach).toBe('platform_metric_unavailable');expect(JSON.stringify(result)).not.toContain('secret');
 });
});
