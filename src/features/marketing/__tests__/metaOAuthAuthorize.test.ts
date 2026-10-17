import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const fixture=vi.hoisted(()=>({handler:null as any,rpc:vi.fn()}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}},error:null})},rpc:fixture.rpc})}));
vi.mock('../../../../supabase/functions/_shared/privacyBlob.ts',()=>({commitJournal:vi.fn()}));
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();fixture.rpc.mockResolvedValue({data:{id:'session'},error:null});
 const values:Record<string,string>={SUPABASE_URL:'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_ENVIRONMENT:'staging',MARKETING_META_APP_ID:'2204918033458414',MARKETING_META_LOGIN_CONFIG_ID:'1398015649111006',MARKETING_META_APP_SECRET:'fixture',MARKETING_META_GRAPH_VERSION:'v26.0',MARKETING_META_TOKEN_ENCRYPTION_KEY:'fixture'};
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(key:string)=>values[key]}});
});
afterEach(()=>vi.unstubAllGlobals());
const request=(purpose:any,connectionId:string|null=null)=>new Request('https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/authorize',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({organizationId:'org',brandId:'brand',connectionId,purpose,configId:'2180882642780186'})});
it.each(['publishing','messaging'])('retains canonical state/reconnect authority for %s and ignores caller config ID',async purpose=>{
 await import('../../../../supabase/functions/marketing-meta/index.ts');
 const response=await fixture.handler(request(purpose,'existing-account'));
 expect(response.status).toBe(200);const url=new URL((await response.json()).authorization_url);
 expect(url.searchParams.get('config_id')).toBe('1398015649111006');
 expect(url.searchParams.get('redirect_uri')).toBe('https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback');
 expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_begin','marketing_meta_reconnect_intent']);
 expect(fixture.rpc).toHaveBeenCalledWith('marketing_meta_begin',expect.objectContaining({p_org:'org',p_brand:'brand',p_state_hash:expect.stringMatching(/^[a-f0-9]{64}$/)}));
 expect(fixture.rpc).toHaveBeenCalledWith('marketing_meta_reconnect_intent',{p_session:'session',p_auth_user:'actor',p_connection:'existing-account'});
});
it('rejects unknown purpose before creating state',async()=>{
 await import('../../../../supabase/functions/marketing-meta/index.ts');
 expect((await fixture.handler(request('arbitrary'))).status).toBe(409);expect(fixture.rpc).not.toHaveBeenCalled();
});
it('does not produce an OAuth URL after canonical reconnect denial',async()=>{
 fixture.rpc.mockImplementation(async name=>name==='marketing_meta_begin'?{data:{id:'session'},error:null}:{error:{code:'42501'}});
 await import('../../../../supabase/functions/marketing-meta/index.ts');
 const response=await fixture.handler(request('messaging','wrong-brand-account'));
 expect(response.status).not.toBe(200);expect(JSON.stringify(await response.json())).not.toContain('authorization_url');
});

it('queues self-service verification under the existing scoped authority without immediate provider reads',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await import('../../../../supabase/functions/marketing-meta/index.ts');
 const response=await fixture.handler(new Request('https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/health',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({connectionId:'existing-account'})}));
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'verification_pending',execution_separately_controlled:true});
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_request_health']);
 expect(fixture.rpc).toHaveBeenCalledWith('marketing_meta_request_health',{p_connection:'existing-account',p_auth_user:'actor'});
 expect(fetcher).not.toHaveBeenCalled();
});
it('does not queue verification after canonical Brand/actor denial',async()=>{
 fixture.rpc.mockResolvedValue({data:null,error:{code:'42501'}});
 await import('../../../../supabase/functions/marketing-meta/index.ts');
 const response=await fixture.handler(new Request('https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/health',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({connectionId:'foreign-account'})}));
 expect(response.status).not.toBe(200);
 expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_request_health']);
});
