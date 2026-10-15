import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const fixture=vi.hoisted(()=>({handler:null as any,rpc:vi.fn(),publish:vi.fn()}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc:fixture.rpc})}));
vi.mock('../../../../supabase/functions/_shared/metaConnectionHealth.ts',()=>({runConnectionHealth:async()=>null}));
vi.mock('../../../../supabase/functions/_shared/metaInboxHistory.ts',()=>({runInboxHistory:async()=>false}));
vi.mock('../../../../supabase/functions/_shared/marketingMediaCleanup.ts',()=>({cleanupTemporaryMedia:async()=>null}));
vi.mock('../../../../supabase/functions/_shared/privacyBlob.ts',()=>({commitJournal:vi.fn()}));
vi.mock('../../../../supabase/functions/_shared/metaAds.ts',()=>({processAdsSync:async()=>false}));
vi.mock('../../../../supabase/functions/_shared/metaPublishing.ts',async original=>({...await original<any>(),advanceMetaPublish:fixture.publish}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();fixture.rpc.mockResolvedValue({data:null,error:null});});
afterEach(()=>vi.unstubAllGlobals());
function environment(extra:Record<string,string>={}){
 const values:Record<string,string>={SUPABASE_URL:'https://oyfobxdoyfuzsodogpgs.supabase.co',MARKETING_ENVIRONMENT:'production',MARKETING_META_APP_ID:'2182829996001809',MARKETING_META_LOGIN_CONFIG_ID:'2027095767950085',MARKETING_META_APP_SECRET:'fixture',MARKETING_META_GRAPH_VERSION:'v26.0',MARKETING_META_TOKEN_ENCRYPTION_KEY:'fixture',MARKETING_WORKER_SECRET:'fixture',...extra};
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>values[key]}});
}
const replies={MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_ACCOUNT_IDS:'111',MARKETING_INBOX_REPLY_PEER_IDS:'333'};
const request=(path:string)=>new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-inbox'+path,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({conversationId:'conversation',text:'Approved fixture reply',requestId:'request',version:1})});
it.each(['/send-approved','/send-staff-reply'])('Production %s defaults closed before recording any send intent',async path=>{
 environment({MARKETING_INBOX_SEND_ENABLED:'true',MARKETING_INBOX_TEST_PEER_IDS:'333'});
 await import('../../../../supabase/functions/marketing-inbox/index.ts');
 expect((await fixture.handler(request(path))).status).toBe(403);expect(fixture.rpc).not.toHaveBeenCalled();
});
it('rejects an unapproved peer before preparing a manual reply',async()=>{
 environment(replies);fixture.rpc.mockResolvedValue({data:{account:'111',peer:'444'},error:null});
 await import('../../../../supabase/functions/marketing-inbox/index.ts');
 expect((await fixture.handler(request('/send-staff-reply'))).status).toBe(403);
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_inbox_staff_send_scope']);
});
it('a runtime allowlist cannot bypass canonical staff approval or authority denial',async()=>{
 environment(replies);fixture.rpc.mockImplementation(async name=>name==='marketing_inbox_staff_send_scope'?{data:{account:'111',peer:'333'},error:null}:{data:null,error:{message:'This reply requires review and approval.'}});
 await import('../../../../supabase/functions/marketing-inbox/index.ts');
 const response=await fixture.handler(request('/send-staff-reply'));
 expect(response.status).toBe(409);expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_inbox_staff_send_scope','marketing_inbox_prepare_staff_reply']);
});
it('Production worker cannot claim publishing from copied Staging flags',async()=>{
 environment({MARKETING_META_TEST_ACCOUNT_IDS:'111'});
 await import('../../../../supabase/functions/marketing-worker/index.ts');
 const response=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-worker/tick',{method:'POST',headers:{'x-marketing-worker-secret':'fixture'}}));
 expect(response.status).toBe(200);expect(fixture.publish).not.toHaveBeenCalled();
 for(const name of ['marketing_claim_job','marketing_claim_reconciliation','marketing_privacy_journal_pending'])expect(fixture.rpc.mock.calls.map(c=>c[0])).not.toContain(name);
});
it('enabled Production publishing still rejects an account outside its approved scope before any provider write',async()=>{
 environment({MARKETING_META_PUBLISHING_ENABLED:'true',MARKETING_META_PUBLISH_ACCOUNT_IDS:'111'});
 fixture.rpc.mockImplementation(async name=>({error:null,data:name==='marketing_claim_job'?{id:'job',lease_token:'lease',state:'leased'}:name==='marketing_job_guard'?{channel:'facebook',provider_account_id:'222',credential_generation:1,status:'test_authorized'}:null}));
 await import('../../../../supabase/functions/marketing-worker/index.ts');
 const response=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-worker/tick',{method:'POST',headers:{'x-marketing-worker-secret':'fixture'}}));
 expect(response.status).toBe(200);expect(fixture.publish).not.toHaveBeenCalled();
 expect(fixture.rpc).toHaveBeenCalledWith('marketing_finish_job',expect.objectContaining({p_outcome:'permanent_failure',p_provider_post_id:null,p_error_code:'external_account_not_enabled'}));
});

it('normal staff mode still cannot bypass canonical conversation approval or authority denial',async()=>{
 environment({MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_MODE:'normal',MARKETING_INBOX_REPLY_ACCOUNT_IDS:'999'});
 fixture.rpc.mockImplementation(async name=>name==='marketing_inbox_staff_send_scope'?{data:{account:'999',peer:'777'},error:null}:{data:null,error:{message:'Messaging authority denied.'}});
 await import('../../../../supabase/functions/marketing-inbox/index.ts');
 expect((await fixture.handler(request('/send-staff-reply'))).status).toBe(409);
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_inbox_staff_send_scope','marketing_inbox_prepare_staff_reply']);
});
it('normal publishing mode cannot bypass the canonical job guard',async()=>{
 environment({MARKETING_META_PUBLISHING_ENABLED:'true',MARKETING_META_PUBLISHING_MODE:'normal'});
 fixture.rpc.mockImplementation(async name=>name==='marketing_job_guard'?{error:{message:'Approved revision or Brand authority changed.'},data:null}:{error:null,data:name==='marketing_claim_job'?{id:'job',lease_token:'lease',state:'leased'}:null});
 await import('../../../../supabase/functions/marketing-worker/index.ts');
 const response=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-worker/tick',{method:'POST',headers:{'x-marketing-worker-secret':'fixture'}}));
 expect(response.status).toBe(200);expect(fixture.publish).not.toHaveBeenCalled();
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toContain('marketing_job_guard');
});

it('normal staff mode rejects another account before recording any reply intent',async()=>{
 environment({MARKETING_INBOX_STAFF_REPLY_ENABLED:'true',MARKETING_INBOX_REPLY_MODE:'normal',MARKETING_INBOX_REPLY_ACCOUNT_IDS:'111'});
 fixture.rpc.mockResolvedValue({data:{account:'999',peer:'777'},error:null});
 await import('../../../../supabase/functions/marketing-inbox/index.ts');
 expect((await fixture.handler(request('/send-staff-reply'))).status).toBe(403);
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_inbox_staff_send_scope']);
});
