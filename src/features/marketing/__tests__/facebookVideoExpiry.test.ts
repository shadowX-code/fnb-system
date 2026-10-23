import {it,expect,vi} from 'vitest';
import {MetaError,MetaGraph} from '../../../../supabase/functions/_shared/metaGraph.ts';
import {advanceMetaPublish,type MetaLedger} from '../../../../supabase/functions/_shared/metaPublishing.ts';
const variant={channel:'facebook' as const,format:'video',caption:'Controlled fixture',asset_ids:['fixture']};
const evidence={id:'900',from:{id:'111'},published:false,status:{video_status:'ready',uploading_phase:{status:'complete'}}};
const config={appId:'1',appSecret:'fixture',configId:'2',version:'v26.0'};
function setup(format='video',state:MetaLedger={}){
 let allowed=true,saved=structuredClone(state),checks=0;
 const transport=vi.fn(async(url:any,options:any)=>new Response(JSON.stringify(options.method==='GET'?evidence:String(url).includes('rupload')?{success:true}:format==='reel'&&!saved.objects?.fb_video?{video_id:'900'}:{id:'900',success:true}),{status:200}));
 const graph=new MetaGraph(config,transport);
 const submissionGuard=vi.fn(async()=>{checks++;if(!allowed)throw new MetaError('facebook_video_authorization_expired');});
 const args={graph,accountId:'111',token:'fixture',variant:{...variant,format},mediaUrls:['https://private.example/fixture.mp4'],guard:async()=>{},submissionGuard};
 return {transport,submissionGuard,revoke:()=>{allowed=false},checks:()=>checks,state:()=>saved,
  run:(patch:any={})=>advanceMetaPublish({...args,state:saved,checkpoint:async(s:MetaLedger)=>{saved=structuredClone(s)},...patch})};
}
it('fails closed if the mandatory video submission guard is missing',async()=>{
 const h=setup();expect((await h.run({submissionGuard:undefined})).outcome).toBe('uncertain');expect(h.transport).not.toHaveBeenCalled();
});
it.each([
 ['video',{}],['reel',{}],['reel',{objects:{fb_video:'900'}}],
 ['video',{objects:{fb_video:'900'}}],['reel',{objects:{fb_video:'900',fb_uploaded:'900'}}]
])('rechecks immediately at transport for every %s submission stage %j',async(format,state)=>{
 const h=setup(format as string,state as MetaLedger);
 // Pre-intent and post-intent pass, but expiry/revocation occurs during Graph request preparation.
 h.submissionGuard.mockImplementation(async()=>{if(h.submissionGuard.mock.calls.length===3)throw new MetaError('expired');});
 expect((await h.run()).outcome).toBe('permanent_failure');
 expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);
 expect(h.submissionGuard).toHaveBeenCalledTimes(3);
});
it('blocks revocation while checkpoint persistence is in flight without losing intent or resending',async()=>{
 const h=setup();let checkpoint:MetaLedger={};
 expect((await h.run({checkpoint:async(s:MetaLedger)=>{checkpoint=structuredClone(s);h.revoke()}})).outcome).toBe('uncertain');
 expect(h.transport).not.toHaveBeenCalled();expect(checkpoint.pending).toBe('fb_video_upload');
 expect((await h.run({state:checkpoint})).outcome).toBe('uncertain');expect(h.transport).not.toHaveBeenCalled();
});
it('retains a response already in flight at revocation, but cannot start the next operation',async()=>{
 const h=setup();let release!:(r:Response)=>void,entered!:()=>void;
 const dispatched=new Promise<void>(r=>{entered=r});
 h.transport.mockImplementationOnce(async()=>{entered();return new Promise<Response>(r=>{release=r})});
 const running=h.run();await dispatched;h.revoke();release(new Response('{"id":"900"}'));
 expect((await running).outcome).toBe('waiting');expect(h.state().objects?.fb_video).toBe('900');
 expect((await h.run({reconcileOnly:true})).outcome).toBe('uncertain');
 expect(h.transport.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
});
it('reconciles a completed in-flight publication after expiry without another write',async()=>{
 const h=setup('video',{pending:'fb_publish',objects:{fb_video:'900'}});h.revoke();
 h.transport.mockResolvedValue(new Response(JSON.stringify({...evidence,published:true,post_id:'111_901'})));
 expect(await h.run({reconcileOnly:true})).toEqual({outcome:'published',postId:'111_901'});
 expect(h.submissionGuard).not.toHaveBeenCalled();expect(h.transport).toHaveBeenCalledOnce();
});
it('concurrent workers still need their own current lease before submitting',async()=>{
 const winner=setup(),stale=setup();stale.submissionGuard.mockRejectedValue(new MetaError('lease_expired'));
 const results=await Promise.all([winner.run(),stale.run()]);
 expect(results.map(r=>r.outcome)).toEqual(['waiting','uncertain']);expect(winner.transport).toHaveBeenCalledOnce();expect(stale.transport).not.toHaveBeenCalled();
});
it('does not impose the video authorization guard on ordinary Facebook or Instagram requests',async()=>{
 for(const channel of ['facebook','instagram'] as const){
  const h=setup();h.revoke();h.transport.mockResolvedValue(new Response('{"id":"901"}'));
  expect((await h.run({variant:{...variant,channel,format:channel==='facebook'?'text':'image',asset_ids:[]},mediaUrls:channel==='facebook'?[]:['https://private.example/i.jpg']})).outcome).toBe(channel==='facebook'?'published':'waiting');
  expect(h.submissionGuard).not.toHaveBeenCalled();expect(h.transport).toHaveBeenCalledOnce();
 }
});
