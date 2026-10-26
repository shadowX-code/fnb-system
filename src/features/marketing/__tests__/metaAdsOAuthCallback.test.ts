import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
const fixture=vi.hoisted(()=>({handler:null as any,rpc:vi.fn(),discover:vi.fn(),seal:vi.fn(),network:vi.fn(),session:null as any,values:{} as Record<string,string>}));
vi.mock('https://esm.sh/@supabase/supabase-js@2.105.4',()=>({createClient:()=>({rpc:fixture.rpc})}));
vi.mock('../../../../supabase/functions/_shared/privacyBlob.ts',()=>({commitJournal:vi.fn()}));
vi.mock('../../../../supabase/functions/_shared/metaAds.ts',async original=>({...await original(),discoverAds:fixture.discover}));
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',async original=>({...await original(),seal:fixture.seal}));
const base='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback';
const request=(code='synthetic-fresh-code',state='S'.repeat(43))=>new Request(`${base}?state=${state}&code=${code}`);
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();
 fixture.session={id:'synthetic-session',actor_employee_id:'employee',purpose:'ads',organization_id:'org',brand_id:null,ads_management_config_id:'999001'};
 fixture.values={SUPABASE_URL:'https://ujkzdaaadnvcfayuldmh.supabase.co',MARKETING_ENVIRONMENT:'staging',MARKETING_META_APP_ID:'2204918033458414',MARKETING_META_LOGIN_CONFIG_ID:'1398015649111006',MARKETING_ADS_MANAGEMENT_LOGIN_CONFIG_ID:'999001',MARKETING_META_APP_SECRET:'synthetic',MARKETING_META_GRAPH_VERSION:'v26.0',MARKETING_META_TOKEN_ENCRYPTION_KEY:'synthetic'};
 fixture.rpc.mockImplementation(async name=>({data:name==='marketing_meta_consume'?fixture.session:null,error:null}));
 fixture.discover.mockResolvedValue({userId:'990000001',accounts:[{id:'990000011',granted_scopes:['ads_read','ads_management'],manage_verified:true}]});
 fixture.seal.mockResolvedValue({synthetic:true});fixture.network.mockRejectedValue(new Error('Real network forbidden in callback tests'));
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',fixture.network);
 vi.stubGlobal('Deno',{serve:(handler:any)=>{fixture.handler=handler},env:{get:(name:string)=>fixture.values[name]}});
});
afterEach(()=>vi.unstubAllGlobals());
async function load(){await import('../../../../supabase/functions/marketing-meta/index.ts');return fixture.handler;}
const providerNotCalled=()=>{expect(fixture.discover).not.toHaveBeenCalled();expect(fixture.seal).not.toHaveBeenCalled();expect(fixture.network).not.toHaveBeenCalled();expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_consume']);};
describe('canonical Ads callback configuration and single-use boundary',()=>{
 it.each(['expired','replayed','revoked'])('requires fresh authorization for %s canonical state before token exchange',async()=>{
  fixture.rpc.mockResolvedValue({data:null,error:{code:'42501'}});
  const handler=await load();const response=await handler(request('old-code'));
  expect(response.status).toBe(409);expect((await response.json()).error).toContain('fresh authorization');providerNotCalled();
 });
 it.each([null,{}, {id:'session',purpose:'other'}])('rejects missing or unknown session evidence %j',async session=>{
  fixture.session=session;const handler=await load();expect((await handler(request())).status).toBe(409);providerNotCalled();
 });
 it.each(['id','organization_id','actor_employee_id'])('rejects missing session %s before token exchange',async key=>{
  delete fixture.session[key];const handler=await load();expect((await handler(request())).status).toBe(409);providerNotCalled();
 });
 it.each([undefined,'','bad-id',999001,'888001','1398015649111006'])('rejects missing/malformed/mismatched pinned config %j before token exchange',async id=>{
  if(id===undefined)delete fixture.session.ads_management_config_id;else fixture.session.ads_management_config_id=id;
  const handler=await load();const response=await handler(request());
  expect(new URL(response.headers.get('location')!).searchParams.get('meta_reason')).toBe('ads_management_login_changed');providerNotCalled();
 });
 it.each(['','888001','1398015649111006'])('rejects runtime removal/rotation/shared config %j',async id=>{
  fixture.values.MARKETING_ADS_MANAGEMENT_LOGIN_CONFIG_ID=id;const handler=await load();const response=await handler(request());
  expect(new URL(response.headers.get('location')!).searchParams.get('meta_reason')).toBe('ads_management_login_changed');providerNotCalled();
 });
 it('stages a successful fresh management discovery only after consume and before any account binding',async()=>{
  const handler=await load();const response=await handler(request());
  expect(response.status).toBe(303);const redirect=new URL(response.headers.get('location')!);expect(redirect.origin).toBe('https://fnb-system-staging.vercel.app');expect(redirect.searchParams.get('meta_result')).toBe('select_account');
  expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_consume','marketing_ads_stage']);
  expect(fixture.discover).toHaveBeenCalledWith(expect.anything(),'synthetic-fresh-code');
  expect(fixture.rpc).toHaveBeenLastCalledWith('marketing_ads_stage',{p_session:'synthetic-session',p_user_id:'990000001',p_sealed:{synthetic:true},p_accounts:expect.any(Array)});
  expect(fixture.rpc.mock.invocationCallOrder[0]).toBeLessThan(fixture.discover.mock.invocationCallOrder[0]);
  expect(fixture.network).not.toHaveBeenCalled();expect(fixture.rpc.mock.calls.some(c=>c[0].includes('bind'))).toBe(false);
 });
 it('rejects a fresh callback when Meta omits the management grant without staging or rotating',async()=>{
  fixture.discover.mockResolvedValue({userId:'990000001',accounts:[{id:'990000011',granted_scopes:['ads_read']}]});
  const handler=await load();const response=await handler(request());expect(new URL(response.headers.get('location')!).searchParams.get('meta_reason')).toBe('ads_management_required');expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_consume']);expect(fixture.seal).not.toHaveBeenCalled();
 });
 it('does not bind or rotate if staging rejects after provider exchange',async()=>{
  fixture.rpc.mockImplementation(async name=>name==='marketing_meta_consume'?{data:fixture.session}:{error:{code:'42501'}});
  const handler=await load();const response=await handler(request());expect(new URL(response.headers.get('location')!).searchParams.get('meta_result')).toBe('authorization_failed');expect(fixture.rpc.mock.calls.map(c=>c[0])).toEqual(['marketing_meta_consume','marketing_ads_stage']);
 });
 it('does not exchange a code twice after concurrent/replayed callbacks',async()=>{
  let consumed=false;fixture.rpc.mockImplementation(async name=>{
   if(name==='marketing_meta_consume'){if(consumed)return {error:{code:'42501'}};consumed=true;return {data:fixture.session};}return {data:null};
  });
  const handler=await load();const responses=await Promise.all([handler(request()),handler(request())]);
  expect(responses.map(r=>r.status).sort()).toEqual([303,409]);expect(fixture.discover).toHaveBeenCalledTimes(1);expect(fixture.rpc.mock.calls.filter(c=>c[0]==='marketing_ads_stage')).toHaveLength(1);
 });
 it('preserves Reporting only with an explicit null management configuration',async()=>{
  fixture.session.ads_management_config_id=null;fixture.discover.mockResolvedValue({userId:'990000001',accounts:[{id:'990000011',granted_scopes:['ads_read']}]});
  const handler=await load();expect((await handler(request())).status).toBe(303);expect(fixture.rpc).toHaveBeenLastCalledWith('marketing_ads_stage',expect.anything());
 });
 it.each([null,undefined])('preserves existing social Publishing/Messaging callback session %j',async id=>{
  fixture.session={id:'social-session',actor_employee_id:'employee',purpose:'social',organization_id:'org',brand_id:'brand'};if(id!==undefined)fixture.session.ads_management_config_id=id;
  const {MetaGraph}=await import('../../../../supabase/functions/_shared/metaGraph.ts');
  const exchange=vi.spyOn(MetaGraph.prototype,'exchange').mockResolvedValue({userId:'990000001',accounts:[]} as any);
  const handler=await load();const response=await handler(request());expect(response.status).toBe(303);expect(exchange).toHaveBeenCalledTimes(1);expect(fixture.discover).not.toHaveBeenCalled();expect(fixture.rpc).toHaveBeenLastCalledWith('marketing_meta_stage',expect.objectContaining({p_session:'social-session'}));expect(fixture.network).not.toHaveBeenCalled();
 });
 it('rejects management evidence attached to a social session',async()=>{
  fixture.session.purpose='social';const handler=await load();await handler(request());providerNotCalled();
 });
 it('rejects invalid state before touching canonical session or provider',async()=>{
  const handler=await load();expect((await handler(request('synthetic','bad'))).status).toBe(400);expect(fixture.rpc).not.toHaveBeenCalled();expect(fixture.discover).not.toHaveBeenCalled();
 });
});
