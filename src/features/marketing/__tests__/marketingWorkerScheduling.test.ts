import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({db:{rpc:vi.fn(),storage:{from:vi.fn()}},health:vi.fn(),publish:vi.fn(),handler:null as any}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>fixture.db}));
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',()=>({META_SCOPES:[],META_REDIRECT:'fixture',STAGING_SUPABASE:'https://ujkzdaaadnvcfayuldmh.supabase.co',hash:async(v:string)=>v,connectionBinding:()=>'',unseal:async()=>({token:'fixture'})}));
vi.mock('../../../../supabase/functions/_shared/metaConnectionHealth.ts',()=>({runConnectionHealth:fixture.health}));
vi.mock('../../../../supabase/functions/_shared/metaConnectionDiagnostics.ts',()=>({diagnoseMetaConnection:async()=>({publishing_evidence:{eligibility:'verified'}})}));
vi.mock('../../../../supabase/functions/_shared/metaPublishing.ts',()=>({advanceMetaPublish:fixture.publish,testAccountEnabled:()=>true,verifyMetaMedia:()=>{}}));
vi.mock('../../../../supabase/functions/_shared/metaInboxHistory.ts',()=>({runInboxHistory:async()=>false}));
vi.mock('../../../../supabase/functions/_shared/metaSynchronization.ts',()=>({readMetaPosts:vi.fn()}));
vi.mock('../../../../supabase/functions/_shared/metaAds.ts',()=>({processAdsSync:async()=>false}));
vi.mock('../../../../supabase/functions/_shared/privacyBlob.ts',()=>({commitJournal:vi.fn()}));
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>key==='SUPABASE_URL'?'https://ujkzdaaadnvcfayuldmh.supabase.co':key==='MARKETING_META_GRAPH_VERSION'?'v26.0':'fixture'}});
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
   name==='marketing_job_guard'?{id:'connection',credential_generation:1,status:'test_authorized',provider_account_id:'111',capabilities:{formats:['text']}}:
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
