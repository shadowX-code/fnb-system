import {describe,it,expect,vi,afterEach} from 'vitest';
import {adsExecutionAllowed,adsExecutionStatus,adsManagementLoginConfig,adsReadOnlyPreflight} from '../../../../supabase/functions/_shared/metaAdsPrerequisites.ts';
import {MetaError,MetaGraph} from '../../../../supabase/functions/_shared/metaGraph.ts';
import {advanceAdsChange} from '../../../../supabase/functions/_shared/metaAdsManagement.ts';
import {webcrypto} from 'node:crypto';
import {adsAuthorizationReason} from '../adsReadiness.js';
const now=Date.parse('2026-10-25T12:00:00Z');
const change={fingerprint:'exact',operation:'create',maximum_budget:1000,paused_create_expires_at:new Date(now+900000).toISOString(),configuration:{create_contract_version:3}};
const env=(extra={})=>(key:string)=>({MARKETING_ADS_EXECUTION_ENABLED:'true',MARKETING_ADS_EXECUTION_APPROVALS:'exact',...extra}[key]||'');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('separate Ads management login',()=>{
 it('keeps missing management setup distinct from reporting reconnect guidance',()=>{
  expect(adsAuthorizationReason('ads_management_required')).toContain('dedicated Ads login');
  expect(adsAuthorizationReason('ads_management_login_changed')).toContain('Existing connections are unchanged');
 });
 it('fails closed for absent, invalid or shared configurations',()=>{
  for(const id of ['', 'invalid','111'])expect(adsManagementLoginConfig(()=>id,'111')).toBeNull();
  expect(adsManagementLoginConfig(()=>'222','111')).toBe('222');
 });
});
describe('Production paused creation boundary',()=>{
 it('reports only fresh exact-revision paused authorization without authorizing activation',()=>{
  const row={...change,id:'request',state:'approved',approval_current:true,approval_expires_at:new Date(now+3600000).toISOString()};
  expect(adsExecutionStatus(env(),row,true,now)).toMatchObject({request_id:'request',fingerprint:'exact',available:true,scope:'paused_create_only',activation_authorized:false});
  expect(adsExecutionStatus(env(),{...row,approval_expires_at:new Date(now+60000).toISOString()},true,now).expires_at).toBe(new Date(now+60000).toISOString());
  for(const state of ['draft','review','executing','reconciling','reconciled','cancelled'])expect(adsExecutionStatus(env(),{...row,state},true,now).available).toBe(false);
  for(const approval_expires_at of [null,'invalid',new Date(now).toISOString()])expect(adsExecutionStatus(env(),{...row,approval_expires_at},true,now).available).toBe(false);
  expect(adsExecutionStatus(env({MARKETING_ADS_EXECUTION_ENABLED:''}),row,true,now).available).toBe(false);
  expect(adsExecutionStatus(env(),{...row,approval_current:false},true,now).available).toBe(false);
  expect(adsExecutionStatus(env(),row,true,now+900000).available).toBe(false);
  expect(adsExecutionStatus(env(),{...row,operation:'resume'},true,now).activation_authorized).toBe(false);
  expect(adsExecutionStatus(env(),{...row,configuration:{...row.configuration,recovery_source:'original'}},false,now).available).toBe(false);
 });
 it('requires both existing runtime gates and an exact unexpired permit',()=>{
  expect(adsExecutionAllowed(env(),change,true,now)).toBe(true);
  for(const extra of [{MARKETING_ADS_EXECUTION_ENABLED:''},{MARKETING_ADS_EXECUTION_APPROVALS:'other'}])expect(adsExecutionAllowed(env(extra),change,true,now)).toBe(false);
  for(const expiry of [null,'invalid',new Date(now).toISOString(),new Date(now+1800001).toISOString()])expect(adsExecutionAllowed(env(),{...change,paused_create_expires_at:expiry},true,now)).toBe(false);
 });
 it.each(['resume','pause','budget'])('never authorizes %s through a paused permit',operation=>{
  expect(adsExecutionAllowed(env(),{...change,operation},true,now)).toBe(false);
 });
 it('rejects recovery, legacy and empty-budget creation while preserving Staging gates',()=>{
  for(const c of [{...change,configuration:{create_contract_version:1}},{...change,configuration:{create_contract_version:3,recovery_source:'old'}},{...change,maximum_budget:0}])expect(adsExecutionAllowed(env(),c,true,now)).toBe(false);
  expect(adsExecutionAllowed(env(),{...change,operation:'resume',paused_create_expires_at:null},false,now)).toBe(true);
 });
});
function fixture(scopes=['ads_read']){
 const account={id:'act_11',account_id:'11',name:'Shared',currency:'MYR',timezone_name:'Asia/Singapore',account_status:1,user_tasks:['ADVERTISE']};
 const rows:any={debug_token:{data:{is_valid:true,app_id:'123',type:'USER',user_id:'9',scopes}},'me/adaccounts':{data:[account]},act_11:account,'me/accounts':{data:[{id:'22',tasks:['ADVERTISE']}]},'act_11/minimum_budgets':{data:[{currency:'MYR',min_daily_budget_imp:500}]},'22_33':{id:'22_33',from:{id:'22'},message:'Original',is_published:true,is_eligible_for_promotion:true,allowed_advertising_objectives:['OUTCOME_AWARENESS'],attachments:{data:[{media_type:'photo'}]}}};
 const graph:any={request:vi.fn(async(path:string,_token:string,_params:any,method='GET')=>{expect(method).toBe('GET');if(rows[path] instanceof Error)throw rows[path];return rows[path];})};
 const material={connection:{provider_account_id:'11',meta_user_id:'9',credential_generation:2},page:{provider_account_id:'22',credential_generation:1},source_post:{provider_post_id:'22_33',caption:'Original',format:'image'}};
 return {rows,graph,material,guard:vi.fn(async()=>{})};
}
describe('credential-bound read-only preflight',()=>{
 it('still checks Page/post and budget with reporting access, without declaring IDs verified',async()=>{
  const f=fixture();const r=await adsReadOnlyPreflight(f.graph,'retained','123','secret',f.material,f.guard);
  expect(r.checks.page.advertising_verified).toBe(true);expect(r.checks.post.eligible).toBe(true);
  expect(r.checks.minimum_budget.impressions_daily_minor).toBe(500);
  expect(r.blockers).toContain('ads_management_required');expect(r.declarations.provider_verified).toBe(false);expect(r.creation_authorized).toBe(false);
 });
 it('does not turn unknown/denied budget or post evidence into zero/eligibility',async()=>{
  const f=fixture(['ads_management']);f.rows['act_11/minimum_budgets']=new MetaError('meta_permission_or_token_invalid');f.rows['22_33'].is_eligible_for_promotion=undefined;
  const r=await adsReadOnlyPreflight(f.graph,'retained','123','secret',f.material,f.guard);
  expect(r.checks.minimum_budget.status).toBe('unavailable');expect(r.checks.minimum_budget.impressions_daily_minor).toBeUndefined();expect(r.checks.post.eligible).toBe(false);expect(r.blockers).toContain('ad_source_post_unverified');
 });
 it.each(['wrong_id','wrong_page','changed_caption','wrong_objective','video'])('rejects %s source evidence',async defect=>{
  const f=fixture(['ads_management']),p=f.rows['22_33'];
  if(defect==='wrong_id')p.id='22_44';if(defect==='wrong_page')p.from.id='44';if(defect==='changed_caption')p.message='Changed';if(defect==='wrong_objective')p.allowed_advertising_objectives=['OUTCOME_TRAFFIC'];if(defect==='video')p.attachments.data[0].media_type='video';
  expect((await adsReadOnlyPreflight(f.graph,'retained','123','secret',f.material,f.guard)).checks.post.eligible).toBe(false);
 });
 it('rejects another token identity and revoked authority without provider writes',async()=>{
  const f=fixture();f.rows.debug_token.data.user_id='8';await expect(adsReadOnlyPreflight(f.graph,'retained','123','secret',f.material,f.guard)).rejects.toMatchObject({code:'ad_authorizer_changed'});
  const g=fixture();g.guard.mockRejectedValue(new MetaError('ads_authority_changed'));await expect(adsReadOnlyPreflight(g.graph,'retained','123','secret',g.material,g.guard)).rejects.toMatchObject({code:'ads_authority_changed'});expect(g.graph.request).not.toHaveBeenCalled();
 });
 it('rejects ambiguous/malformed or paginated minimum-budget responses',async()=>{
  for(const response of [{data:[{currency:'USD',min_daily_budget_imp:100}]},{data:[{currency:'MYR',min_daily_budget_imp:null}]},{data:[{currency:'MYR',min_daily_budget_imp:100}],paging:{next:'untrusted'}}]){
   const f=fixture();f.rows['act_11/minimum_budgets']=response;const r=await adsReadOnlyPreflight(f.graph,'retained','123','secret',f.material,f.guard);expect(r.checks.minimum_budget.status).toBe('unavailable');
  }
 });
});
describe('submission-boundary protection',()=>{
 it('rechecks revocation after write-ahead persistence before the first creation POST',async()=>{
  let enabled=true;const writes=[];
  const graph:any={request:vi.fn(async(path:string,_token:string,_params:any,method='GET')=>{
   if(method!=='GET')writes.push(path);
   if(path==='me/accounts')return {data:[{id:'22',tasks:['ADVERTISE']}]};
   if(path==='22_33')return {id:'22_33',from:{id:'22'},message:'Original',is_published:true,is_eligible_for_promotion:true,allowed_advertising_objectives:['OUTCOME_AWARENESS'],attachments:{data:[]}};
   throw new Error('Unexpected provider request');
  })};
  const c={...change,account_id:'11',configuration:{create_contract_version:3,adset_contract_version:2,creative_source:'facebook_post',start_time:'2099-01-01T00:00:00Z',page_id:'22',placements:'facebook_feed',objective:'OUTCOME_AWARENESS',audience:{type:'radius'},source_post:{page_id:'22',provider_post_id:'22_33',caption:'Original',format:'text'}}};
  await expect(advanceAdsChange({graph,token:'fixture',change:c,state:{},guard:async()=>{if(!enabled)throw new MetaError('ads_execution_disabled');},checkpoint:async(s:any)=>{if(s.pending==='campaign')enabled=false;}})).rejects.toMatchObject({code:'ads_execution_disabled'});
  expect(writes).toHaveLength(0);
 });
 it('does not replay or resolve the preserved pending Ad Set',async()=>{
  const graph:any={request:vi.fn()};const state={campaign_id:'120250881980710774',pending:'adset',image_hash:'retained'};
  const result=await advanceAdsChange({graph,change:{...change,account_id:'11'},state,reconcileOnly:true,guard:vi.fn(),checkpoint:vi.fn()});
  expect(result.outcome).toBe('reconciling');expect(graph.request).not.toHaveBeenCalled();expect(state.pending).toBe('adset');
 });
 it('permits the existing typed Meta city search without permitting arbitrary hosts/endpoints',async()=>{
  vi.stubGlobal('crypto',webcrypto);const transport=vi.fn(async()=>new Response(JSON.stringify({data:[]}),{status:200}));
  const graph=new MetaGraph({appId:'123',appSecret:'synthetic',configId:'456',version:'v26.0'},transport as typeof fetch);
  await graph.request('search','synthetic-user',{type:'adgeolocation',location_types:['city'],country_code:'MY',q:'Ipoh'});
  expect(transport).toHaveBeenCalledTimes(1);
  await expect(graph.request('https://other.invalid','synthetic-user')).rejects.toMatchObject({code:'invalid_meta_endpoint'});
  await expect(graph.request('search','synthetic-user',{type:'adinterest',q:'Food'})).rejects.toMatchObject({code:'invalid_meta_endpoint'});
  await expect(graph.request('search','synthetic-user',{type:'adgeolocation',country_code:'US',location_types:['city'],q:'Boston'})).rejects.toMatchObject({code:'invalid_meta_endpoint'});
 });
});
