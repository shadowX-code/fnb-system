import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({db:{rpc:vi.fn(),storage:{from:vi.fn()}},health:vi.fn(),publish:vi.fn(),handler:null as any}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>fixture.db}));
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',()=>({META_SCOPES:[],META_REDIRECT:'fixture',get RUNTIME_SUPABASE(){return Deno.env.get('SUPABASE_URL')},hash:async(v:string)=>v,connectionBinding:()=>'',unseal:async()=>({token:'fixture'})}));
vi.mock('../../../../supabase/functions/_shared/metaConnectionHealth.ts',()=>({runConnectionHealth:fixture.health}));
vi.mock('../../../../supabase/functions/_shared/metaConnectionDiagnostics.ts',()=>({diagnoseMetaConnection:async()=>({publishing_evidence:{eligibility:'verified'}})}));
vi.mock('../../../../supabase/functions/_shared/metaPublishing.ts',()=>({advanceMetaPublish:fixture.publish,testAccountEnabled:()=>true,verifyMetaMedia:()=>{}}));
vi.mock('../../../../supabase/functions/_shared/metaInboxHistory.ts',()=>({runInboxHistory:async()=>false}));
vi.mock('../../../../supabase/functions/_shared/metaSynchronization.ts',()=>({readMetaPosts:vi.fn()}));
vi.mock('../../../../supabase/functions/_shared/metaAds.ts',()=>({processAdsSync:async()=>false}));
vi.mock('../../../../supabase/functions/_shared/privacyBlob.ts',()=>({commitJournal:vi.fn()}));
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>key==='SUPABASE_URL'?'https://ujkzdaaadnvcfayuldmh.supabase.co':key==='MARKETING_META_GRAPH_VERSION'?'v26.0':key==='MARKETING_META_APP_ID'?'2204918033458414':key==='MARKETING_META_LOGIN_CONFIG_ID'?'1398015649111006':key==='MARKETING_META_TEST_ACCOUNT_IDS'?'111':key==='MARKETING_ENVIRONMENT'?'staging':'fixture'}});
 await import('../../../../supabase/functions/marketing-worker/index.ts');
 fixture.health.mockResolvedValue({messaging:{state:'awaiting_first_delivery'}});
 fixture.publish.mockResolvedValue({outcome:'published',postId:'fixture-receipt'});
});
afterEach(()=>vi.unstubAllGlobals());
const tick=()=>fixture.handler(new Request('https://worker.test/tick',{method:'POST',headers:{'x-marketing-worker-secret':'fixture'}}));
it('concurrent due publishing jobs progress before perpetually due health checks, without duplicate claims',async()=>{
 let next=0;const finalized=new Set();
 fixture.db.rpc.mockImplementation(async(name:string,args:any)=>{
  const data=name==='marketing_claim_job'?{id:++next,lease_token:'lease-'+next,channel:'facebook',state:'queued',payload:{variants:[{channel:'facebook',format:'text',asset_ids:[]}]}}:
   name==='marketing_job_guard'?{id:'connection',channel:'facebook',credential_generation:1,status:'test_authorized',provider_account_id:'111',capabilities:{formats:['text']}}:
   name==='marketing_meta_connection_material'?{credential_generation:1,sealed_token:{}}:
   name==='marketing_job_assets'?[]:name==='marketing_privacy_journal_pending'?[]:null;
  if(name==='marketing_finish_job'){expect(finalized.has(args.p_job)).toBe(false);finalized.add(args.p_job);expect(args.p_outcome).toBe('published');}
  return {data,error:null};
 });
 const responses=await Promise.all(Array.from({length:10},()=>tick()));
 expect(finalized.size).toBe(10);expect(fixture.publish).toHaveBeenCalledTimes(10);expect(fixture.health).toHaveBeenCalledTimes(10);
 for(const r of responses)expect(await r.json()).toMatchObject({status:'processed',outcome:'published'});
 expect(fixture.db.rpc.mock.invocationCallOrder[fixture.db.rpc.mock.calls.findIndex(([name])=>name==='marketing_finish_job')]).toBeLessThan(fixture.health.mock.invocationCallOrder[0]);
});
it('does not call the provider when the existing job execution guard denies it',async()=>{
 fixture.db.rpc.mockImplementation(async(name:string)=>({data:name==='marketing_claim_job'?{id:1,lease_token:'lease',channel:'facebook',payload:{variants:[]}}:name==='marketing_job_guard'?{status:'disabled'}:name==='marketing_privacy_journal_pending'?[]:null,error:null}));
 await tick();expect(fixture.publish).not.toHaveBeenCalled();
 expect(fixture.db.rpc).toHaveBeenCalledWith('marketing_finish_job',expect.objectContaining({p_outcome:'permanent_failure',p_error_code:'external_account_not_enabled'}));
});
it('still runs one health turn when no publishing job is due',async()=>{
 fixture.db.rpc.mockResolvedValue({data:null,error:null});
 const r=await tick();expect(await r.json()).toEqual({status:'connection_checked'});
 expect(fixture.db.rpc).toHaveBeenCalledWith('marketing_claim_reconciliation',{});expect(fixture.db.rpc).toHaveBeenCalledWith('marketing_claim_job',{});
 expect(fixture.publish).not.toHaveBeenCalled();expect(fixture.health).toHaveBeenCalledTimes(1);
});

it('Production runs bounded health without claiming publishing even with copied test flags',async()=>{
 vi.resetModules();vi.clearAllMocks();
 const values:Record<string,string>={SUPABASE_URL:'https://oyfobxdoyfuzsodogpgs.supabase.co',MARKETING_ENVIRONMENT:'production',MARKETING_META_APP_ID:'2182829996001809',MARKETING_META_LOGIN_CONFIG_ID:'2027095767950085',MARKETING_META_GRAPH_VERSION:'v26.0',MARKETING_META_TEST_ACCOUNT_IDS:'111'};
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>values[key]||'fixture'}});
 await import('../../../../supabase/functions/marketing-worker/index.ts');
 fixture.db.rpc.mockResolvedValue({data:null,error:null});fixture.health.mockResolvedValue({messaging:{state:'awaiting_first_delivery'}});
 const result=await tick();expect(await result.json()).toEqual({status:'connection_checked'});
 expect(fixture.db.rpc.mock.calls.map(c=>c[0])).not.toContain('marketing_privacy_journal_pending');
 expect(fixture.db.rpc.mock.calls.map(c=>c[0])).not.toContain('marketing_claim_job');expect(fixture.db.rpc.mock.calls.map(c=>c[0])).not.toContain('marketing_claim_reconciliation');expect(fixture.publish).not.toHaveBeenCalled();
});
it('rejects a Production project with Staging app credentials before queue work',async()=>{
 vi.resetModules();vi.clearAllMocks();
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>key==='SUPABASE_URL'?'https://oyfobxdoyfuzsodogpgs.supabase.co':key==='MARKETING_ENVIRONMENT'?'production':key==='MARKETING_META_APP_ID'?'2204918033458414':key==='MARKETING_META_LOGIN_CONFIG_ID'?'2027095767950085':'fixture'}});
 await import('../../../../supabase/functions/marketing-worker/index.ts');
 expect((await tick()).status).toBe(403);expect(fixture.db.rpc).not.toHaveBeenCalled();expect(fixture.publish).not.toHaveBeenCalled();
});
it('wires video submissions to fresh canonical submission authority rather than its cached initial readiness',async()=>{
 const initialGet=Deno.env.get;
 vi.stubGlobal('Deno',{env:{get:(key:string)=>key==='MARKETING_META_FACEBOOK_VIDEO_ENABLED'?'true':initialGet(key)}});
 let revoked=false;
 fixture.db.rpc.mockImplementation(async(name:string,args:any)=>{
  if(name==='marketing_job_guard'&&args.p_submission&&revoked)return {data:null,error:{message:'expired'}};
  return {data:name==='marketing_claim_job'?{id:'job',lease_token:'lease',channel:'facebook',state:'leased',payload:{variants:[{channel:'facebook',format:'video',asset_ids:[]}]}}:
   name==='marketing_job_guard'?{id:'connection',channel:'facebook',credential_generation:1,status:'test_authorized',provider_account_id:'111',facebook_video_authorized:true,format_authorizations:{facebook_video:'temporary'},capabilities:{formats:['video']}}:
   name==='marketing_meta_connection_material'?{credential_generation:1,sealed_token:{}}:
   name==='marketing_job_assets'||name==='marketing_privacy_journal_pending'?[]:null,error:null};
 });
 fixture.publish.mockImplementationOnce(async(input:any)=>{
  await input.submissionGuard();revoked=true;
  await expect(input.submissionGuard()).rejects.toThrow('marketing_authority_rejected');
  return {outcome:'uncertain',code:'authorization_revoked_before_submission'};
 });
 await tick();expect(fixture.publish).toHaveBeenCalledOnce();
 expect(fixture.db.rpc.mock.calls.filter(([n,a])=>n==='marketing_job_guard'&&a.p_submission)).toHaveLength(2);
 expect(fixture.db.rpc).toHaveBeenCalledWith('marketing_finish_job',expect.objectContaining({p_outcome:'uncertain'}));
});
it.each([false,true])('keeps existing Video reconciliation read-only and lookup explicitly permitted=%s',async permitted=>{
 const job={id:'existing-video-job',connection_id:'connection',connection_generation:1,lease_token:'existing-lease',channel:'facebook',state:'reconciling',provider_state:{objects:{fb_video:'1830341231428452',fb_finish:'1830341231428452'}},payload:{variants:[{channel:'facebook',format:'video',caption:'retained',asset_ids:[]}]}};
 const baseGet=(globalThis as any).Deno.env.get,now=Date.now();
 (globalThis as any).Deno.env.get=(key:string)=>key==='MARKETING_META_FACEBOOK_RECEIPT_RECOVERY'?permitted?JSON.stringify({job_id:job.id,connection_id:job.connection_id,generation:1,video_id:'1830341231428452',post_id:'111_901',issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+60000).toISOString()}):undefined:baseGet(key);
 fixture.db.rpc.mockImplementation(async(name:string)=>({data:name==='marketing_claim_reconciliation'?job:name==='marketing_job_guard'?{id:'connection',channel:'facebook',credential_generation:1,status:'test_authorized',provider_account_id:'111',capabilities:{formats:['video']}}:name==='marketing_meta_connection_material'?{credential_generation:1,sealed_token:{}}:name==='marketing_job_assets'?[]:null,error:null}));
 fixture.publish.mockImplementationOnce(async(input:any)=>{
  expect(input.reconcileOnly).toBe(true);expect(input.allowFacebookReceiptLookup()).toBe(permitted);
  expect(input.state).toEqual(job.provider_state);await expect(input.submissionGuard()).rejects.toThrow();
  return {outcome:'uncertain',code:'facebook_video_post_receipt_missing'};
 });
 expect((await tick()).status).toBe(200);expect(fixture.publish).toHaveBeenCalledOnce();
 expect(fixture.db.rpc.mock.calls.some(([name])=>name==='marketing_claim_job')).toBe(false);
 expect(fixture.db.rpc.mock.calls.find(([name])=>name==='marketing_finish_job')?.[1]).toMatchObject({p_job:job.id,p_outcome:'uncertain'});
});
it.each([false,true])('preserves partial Instagram carousel checkpoints with current Extended authorization=%s',async authorized=>{
 const job={id:'existing-mixed-job',connection_id:'connection',connection_generation:1,lease_token:'lease',channel:'instagram',state:'leased',provider_state:{objects:{child_0:'800'},verified_assets:['image','video']},payload:{variants:[{channel:'instagram',format:'carousel',caption:'retained',asset_ids:['image','video']}]}};
 const baseGet=(globalThis as any).Deno.env.get;(globalThis as any).Deno.env.get=(key:string)=>key==='MARKETING_META_INSTAGRAM_EXTENDED_ENABLED'?'true':baseGet(key);
 fixture.db.storage.from.mockReturnValue({createSignedUrl:vi.fn().mockResolvedValue({data:{signedUrl:'https://private.example/fixture'},error:null})});
 fixture.db.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='marketing_claim_job'?job:name==='marketing_job_guard'?{id:'connection',channel:'instagram',credential_generation:1,status:'test_authorized',provider_account_id:'111',instagram_extended_authorized:authorized,capabilities:{formats:['carousel']}}:name==='marketing_meta_connection_material'?{credential_generation:1,sealed_token:{}}:name==='marketing_job_assets'?[{id:'image',mime_type:'image/jpeg'},{id:'video',mime_type:'video/mp4'}]:null,error:name==='marketing_job_guard'&&args.p_submission&&!authorized?{message:'Expired authorization'}:null}));
 fixture.publish.mockImplementationOnce(async(input:any)=>{
  expect(input.reconcileOnly).toBe(!authorized);expect(input.state.objects).toEqual({child_0:'800'});
  if(authorized)await expect(input.submissionGuard()).resolves.toBeUndefined();else await expect(input.submissionGuard()).rejects.toThrow();
  return {outcome:'uncertain',code:'manual_reconciliation_required'};
 });
 expect((await tick()).status).toBe(200);expect(fixture.publish).toHaveBeenCalledOnce();
 if(!authorized)expect(fixture.db.storage.from).not.toHaveBeenCalled();
});
it.each([['facebook','video','facebook_video'],['facebook','reel','facebook_reel'],['instagram','carousel','instagram_mixed_carousel']])('routine %s/%s pins authority and reaches the shared adapter with QA gates off',async(channel,format,key)=>{
 const job={id:'routine-job',channel,state:'leased',lease_token:'lease',provider_state:{verified_assets:['pic','vid']},payload:{variants:[{channel,format,asset_ids:format==='carousel'?['pic','vid']:['vid']} ]}};
 const c={id:'connection',channel,credential_generation:1,status:'test_authorized',provider_account_id:'111',format_authorizations:{[key]:'routine'},capabilities:{formats:[format]}};
 fixture.db.storage.from.mockReturnValue({createSignedUrl:vi.fn().mockResolvedValue({data:{signedUrl:'https://private.test/fixture'},error:null})});
 fixture.db.rpc.mockImplementation(async(name:string)=>({data:name==='marketing_claim_job'?job:name==='marketing_job_guard'?c:name==='marketing_meta_connection_material'?{credential_generation:1,sealed_token:{}}:name==='marketing_job_assets'?[{id:'pic',mime_type:'image/jpeg',object_path:'pic'},{id:'vid',mime_type:'video/mp4',object_path:'vid'}]:name==='marketing_privacy_journal_pending'?[]:null,error:null}));
 fixture.publish.mockImplementationOnce(async input=>{expect(input.state.format_authorization_kind).toBe('routine');expect(input.reconcileOnly).toBe(false);await input.submissionGuard();c.format_authorizations={};await expect(input.submissionGuard()).rejects.toThrow('format_execution_disabled');return {outcome:'uncertain',code:'admitted_result_unavailable'};});
 await tick();expect(fixture.publish).toHaveBeenCalledOnce();expect(fixture.db.rpc).toHaveBeenCalledWith('marketing_job_checkpoint',expect.objectContaining({p_state:expect.objectContaining({format_authorization_kind:'routine'})}));
});
it('a later QA lease cannot resume an existing routine-prepared mixed job',async()=>{
 const get=Deno.env.get;(globalThis as any).Deno.env.get=(key:string)=>key==='MARKETING_META_INSTAGRAM_EXTENDED_ENABLED'?'true':get(key);
 const job={id:'held',channel:'instagram',state:'leased',lease_token:'lease',provider_state:{format_authorization_kind:'routine',verified_assets:['pic','vid'],objects:{child_0:'800'}},payload:{variants:[{channel:'instagram',format:'carousel',asset_ids:['pic','vid']} ]}};
 fixture.db.rpc.mockImplementation(async(name:string)=>({data:name==='marketing_claim_job'?job:name==='marketing_job_guard'?{id:'connection',channel:'instagram',credential_generation:1,status:'test_authorized',provider_account_id:'111',format_authorizations:{instagram_mixed_carousel:'temporary'},capabilities:{formats:['carousel']}}:name==='marketing_meta_connection_material'?{credential_generation:1,sealed_token:{}}:name==='marketing_job_assets'?[{id:'pic',mime_type:'image/jpeg'},{id:'vid',mime_type:'video/mp4'}]:name==='marketing_privacy_journal_pending'?[]:null,error:null}));
 fixture.publish.mockImplementationOnce(async input=>{expect(input.reconcileOnly).toBe(true);await expect(input.submissionGuard()).rejects.toThrow('format_execution_disabled');return {outcome:'uncertain',code:'retain_existing_child'};});await tick();expect(fixture.publish).toHaveBeenCalledOnce();expect(fixture.db.storage.from).not.toHaveBeenCalled();
});
