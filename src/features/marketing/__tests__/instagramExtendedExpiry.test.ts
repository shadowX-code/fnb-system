import {it,expect,vi} from 'vitest';
import {advanceMetaPublish,type MetaLedger} from '../../../../supabase/functions/_shared/metaPublishing.ts';
import {MetaGraph,MetaError} from '../../../../supabase/functions/_shared/metaGraph.ts';
const variant={channel:'instagram' as const,format:'carousel',caption:'Reviewed exact caption',asset_ids:['image','video']};
const stages:MetaLedger[]=[{}, {objects:{child_0:'800'}},{objects:{child_0:'800',child_1:'801',ready_1:'801'}},{objects:{child_0:'800',child_1:'801',ready_1:'801',container:'802'}}];
function setup(initial:MetaLedger={}){
 let state=structuredClone(initial),allowed=true;const guard=vi.fn().mockResolvedValue(undefined),submissionGuard=vi.fn(async()=>{if(!allowed)throw new MetaError('expired_or_revoked')});
 const transport=vi.fn(async(url:any,options:any)=>new Response(JSON.stringify(options.method==='POST'?{id:'900'}:new URL(url).pathname.endsWith('/900')?{id:'900'}:{status_code:'FINISHED'})));
 const graph=new MetaGraph({appId:'1',appSecret:'fixture-secret',configId:'2',version:'v26.0'},transport);
 const checkpoint=vi.fn(async(s:MetaLedger)=>{state=structuredClone(s)});
 return {transport,submissionGuard,checkpoint,guard,state:()=>state,revoke:()=>{allowed=false},run:(patch:any={})=>advanceMetaPublish({graph,accountId:'111',token:'fixture-token',variant,mediaUrls:['https://private.example/image.jpg','https://private.example/video.mp4'],mediaTypes:['image/jpeg','video/mp4'],state,checkpoint,guard,submissionGuard,...patch})};
}
it.each(stages.map(state=>[state]))('requires current authority at intent, checkpoint and final HTTP boundary for %j',async state=>{
 const h=setup(state);h.submissionGuard.mockImplementation(async()=>{if(h.submissionGuard.mock.calls.length===3)throw new MetaError('expired')});
 expect((await h.run()).outcome).toBe('uncertain');expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);expect(h.submissionGuard).toHaveBeenCalledTimes(3);expect(h.state().pending).toBeTruthy();
});
it.each(stages.map(state=>[state]))('does not dispatch without the mandatory submission callback %j',async state=>{
 const h=setup(state);expect((await h.run({submissionGuard:undefined})).outcome).toBe('uncertain');expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);expect(h.state()).toEqual(state);
});
it('revocation while checkpoint persistence is in flight stops the write and preserves intent',async()=>{
 const h=setup(stages[1]);expect((await h.run({checkpoint:async(s:MetaLedger)=>{await h.checkpoint(s);h.revoke()}})).outcome).toBe('uncertain');
 expect(h.transport).not.toHaveBeenCalled();expect(h.state().pending).toBe('child_1');expect(h.state().objects?.child_0).toBe('800');
 expect((await h.run({reconcileOnly:true})).outcome).toBe('uncertain');expect(h.transport).not.toHaveBeenCalled();
});
it('preserves an admitted child response after revocation without creating another child/parent',async()=>{
 const h=setup(stages[1]);let release!:(r:Response)=>void,entered!:()=>void;const dispatched=new Promise<void>(r=>{entered=r});
 h.transport.mockImplementationOnce(async()=>{entered();return new Promise<Response>(r=>{release=r})});
 const running=h.run();await dispatched;h.revoke();release(new Response('{"id":"801"}'));
 expect((await running).outcome).toBe('waiting');expect(h.state().objects).toEqual({child_0:'800',child_1:'801'});
 expect((await h.run({reconcileOnly:true})).outcome).toBe('uncertain');expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
});
it.each(['IN_PROGRESS','FINISHED','PUBLISHED'])('reads an existing parent after expiry without publishing it again (%s)',async status=>{
 const h=setup(stages[3]);h.revoke();h.transport.mockResolvedValue(new Response(JSON.stringify({status_code:status})));
 expect(await h.run({reconcileOnly:true})).toMatchObject({outcome:'uncertain',code:status==='PUBLISHED'?'published_receipt_unavailable':'meta_publication_unverified'});
 expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][1].method).toBe('GET');expect(h.state()).toEqual(stages[3]);
});
it('retains a dispatched publication receipt after expiry and verifies it read-only on retry',async()=>{
 const h=setup(stages[3]);let release!:(r:Response)=>void,entered!:()=>void;const dispatched=new Promise<void>(r=>{entered=r});
 h.transport.mockImplementationOnce(async()=>new Response('{"status_code":"FINISHED"}')).mockImplementationOnce(async()=>{entered();return new Promise<Response>(r=>{release=r})});
 const running=h.run();await dispatched;h.revoke();release(new Response('{"id":"900"}'));
 expect(await running).toEqual({outcome:'published',postId:'900'});expect(await h.run({reconcileOnly:true})).toEqual({outcome:'published',postId:'900'});
 expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);expect(h.state().objects).toEqual(stages[3].objects);
});
it('never repeats a lost media_publish response even if the parent reports PUBLISHED',async()=>{
 const h=setup({...stages[3],pending:'publish'});h.revoke();h.transport.mockResolvedValue(new Response('{"status_code":"PUBLISHED"}'));
 expect(await h.run({reconcileOnly:true})).toEqual({outcome:'uncertain',code:'published_receipt_unavailable'});expect(h.transport.mock.calls.every(([,o])=>o.method==='GET')).toBe(true);expect(h.state().pending).toBe('publish');
});
it('each concurrent worker needs its own current canonical lease',async()=>{
 const winner=setup(),stale=setup();stale.submissionGuard.mockRejectedValue(new MetaError('lease_expired'));
 expect((await Promise.all([winner.run(),stale.run()])).map(r=>r.outcome)).toEqual(['waiting','uncertain']);expect(winner.transport).toHaveBeenCalledOnce();expect(stale.transport).not.toHaveBeenCalled();
});
it('Stories require the same transport-time authorization',async()=>{
 for(const state of [{},{objects:{container:'802'}}]){
  const h=setup(state);h.submissionGuard.mockImplementation(async()=>{if(h.submissionGuard.mock.calls.length===3)throw new MetaError('revoked')});
  expect((await h.run({variant:{...variant,format:'story',asset_ids:['video']},mediaTypes:['video/mp4'],mediaUrls:['https://private.example/video.mp4']})).outcome).toBe('uncertain');expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);
 }
});
it('ordinary Instagram image, image-only carousel, Reel and Facebook text do not require the Extended lease',async()=>{
 for(const [channel,format,types] of [['instagram','image',['image/jpeg']],['instagram','carousel',['image/jpeg','image/jpeg']],['instagram','reel',['video/mp4']],['facebook','text',[]]] as const){
  const h=setup();h.revoke();expect(['waiting','published']).toContain((await h.run({variant:{...variant,channel,format},mediaTypes:[...types]})).outcome);expect(h.submissionGuard).not.toHaveBeenCalled();expect(h.transport).toHaveBeenCalledOnce();
 }
});
