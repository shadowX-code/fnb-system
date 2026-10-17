import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({handler:null as any,client:vi.fn(),put:vi.fn(),get:vi.fn(),del:vi.fn(),list:vi.fn()}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:fixture.client}));
vi.mock('https://esm.sh/@vercel/blob@2.8.1?target=es2022',()=>({put:fixture.put,get:fixture.get,del:fixture.del,list:fixture.list}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();});
afterEach(()=>vi.unstubAllGlobals());
function environment(production=true,extra:Record<string,string>={}){
 const values:Record<string,string>={SUPABASE_URL:production?'https://oyfobxdoyfuzsodogpgs.supabase.co':'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_ENVIRONMENT:production?'production':'staging',MARKETING_META_APP_ID:production?'2182829996001809':'2204918033458414',MARKETING_META_LOGIN_CONFIG_ID:production?'2027095767950085':'1398015649111006',...extra};
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>values[key]||'fixture'}});
}
it.each(['/erase-customer','/release-hold','/restore-replay','/retention-status','/retention-review','/retention-compact'])('Production blocks %s before any authority or Blob operation',async path=>{
 environment();await import('../../../../supabase/functions/marketing-privacy/index.ts');
 const result=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-privacy'+path,{method:'POST',headers:{'x-marketing-worker-secret':'fixture'},body:'{}'}));
 expect(result.status).toBe(503);expect(fixture.client).not.toHaveBeenCalled();expect(fixture.list).not.toHaveBeenCalled();expect(fixture.put).not.toHaveBeenCalled();expect(fixture.get).not.toHaveBeenCalled();
});
it.each([
 {MARKETING_PRIVACY_PROCESSING_ENABLED:'true'},
 {MARKETING_PRIVACY_RETENTION_ENABLED:'true'},
 {MARKETING_PRIVACY_PROCESSING_ENABLED:'true',MARKETING_PRIVACY_RETENTION_ENABLED:'TRUE'},
])('Production requires both exact privacy enable flags before I/O: %j',async flags=>{
 environment(true,flags);await import('../../../../supabase/functions/marketing-privacy/index.ts');
 const result=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-privacy/retention-compact',{method:'POST',headers:{'x-marketing-worker-secret':'fixture'},body:'{}'}));
 expect(result.status).toBe(503);expect(fixture.client).not.toHaveBeenCalled();
 for(const call of [fixture.put,fixture.get,fixture.del,fixture.list])expect(call).not.toHaveBeenCalled();
});
it('enabled privacy still rejects an invalid operator secret before authority or Blob I/O',async()=>{
 environment(true,{MARKETING_PRIVACY_PROCESSING_ENABLED:'true',MARKETING_PRIVACY_RETENTION_ENABLED:'true'});
 await import('../../../../supabase/functions/marketing-privacy/index.ts');
 const result=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-privacy/retention-status',{method:'POST',headers:{'x-marketing-worker-secret':'wrong'},body:'{}'}));
 expect(result.status).toBe(401);expect(fixture.client).not.toHaveBeenCalled();
 for(const call of [fixture.put,fixture.get,fixture.del,fixture.list])expect(call).not.toHaveBeenCalled();
});
it('enabled retention status delegates only to the canonical authority after operator authentication',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{status:'review_required'},error:null});fixture.client.mockReturnValue({rpc});
 environment(true,{MARKETING_PRIVACY_PROCESSING_ENABLED:'true',MARKETING_PRIVACY_RETENTION_ENABLED:'true'});
 await import('../../../../supabase/functions/marketing-privacy/index.ts');
 const result=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-privacy/retention-status',{method:'POST',headers:{'x-marketing-worker-secret':'fixture'},body:'{}'}));
 expect(result.status).toBe(200);expect(rpc).toHaveBeenCalledWith('marketing_privacy_retention',{p_action:'status'});
 for(const call of [fixture.put,fixture.get,fixture.del,fixture.list])expect(call).not.toHaveBeenCalled();
});
it.each(['/deauthorize','/data-deletion'])('Production defers Meta %s without fabricating a success receipt',async path=>{
 environment();await import('../../../../supabase/functions/marketing-meta/index.ts');
 const result=await fixture.handler(new Request('https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/marketing-meta'+path,{method:'POST',body:'signed_request=fixture'}));
 expect(result.status).toBe(503);expect(await result.json()).not.toHaveProperty('confirmation_code');expect(fixture.client).not.toHaveBeenCalled();expect(fixture.put).not.toHaveBeenCalled();
});
it('Production shared journal storage refuses installed credentials without any I/O',async()=>{
 environment();const {blobJournalStore,commitJournal}=await import('../../../../supabase/functions/_shared/privacyBlob.ts');
 expect(()=>blobJournalStore()).toThrow('privacy_processing_disabled');
 const db={rpc:vi.fn()};await expect(commitJournal(db,{id:'fixture',payload:'fixture'})).rejects.toThrow('privacy_processing_disabled');
 expect(db.rpc).not.toHaveBeenCalled();expect(fixture.put).not.toHaveBeenCalled();expect(fixture.get).not.toHaveBeenCalled();
});
it('Staging retains its existing configured journal adapter',async()=>{
 environment(false);const {blobJournalStore}=await import('../../../../supabase/functions/_shared/privacyBlob.ts');
 const store=blobJournalStore();expect(typeof store.put).toBe('function');expect(typeof store.get).toBe('function');expect(fixture.put).not.toHaveBeenCalled();
});
