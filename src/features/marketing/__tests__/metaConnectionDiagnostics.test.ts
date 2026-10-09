import { webcrypto } from 'node:crypto';
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest';
import { MetaGraph } from '../../../../supabase/functions/_shared/metaGraph.ts';
import { diagnoseMetaConnection, verifiedFacebookRead } from '../../../../supabase/functions/_shared/metaConnectionDiagnostics.ts';
const config={appId:'123',appSecret:'secret',configId:'456',version:'v26.0'};
const response=(v:any,status=200)=>new Response(JSON.stringify(v),{status});
describe('read-only Meta connection diagnostics',()=>{
 beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>vi.unstubAllGlobals());
 it('isolates an optional-field denial and returns only sanitized evidence',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(response({data:{is_valid:true,app_id:'123',type:'PAGE',profile_id:'111',user_id:'private-subject',scopes:['pages_read_engagement','unknown-private-scope'],expires_at:0}}))
   .mockResolvedValueOnce(response({id:'111'})).mockResolvedValueOnce(response({error:{code:10,error_subcode:2018336,message:'private-name token-secret requires pages_read_user_content'}},403))
   .mockResolvedValueOnce(response({data:[{id:'111_222',message:'private-caption'}]})).mockResolvedValueOnce(response({data:[]})).mockResolvedValueOnce(response({data:[]}))
   .mockResolvedValueOnce(response({error:{code:10,message:'private-name token-secret requires pages_read_user_content'}},403)).mockResolvedValueOnce(response({data:[]}));
  const guard=vi.fn(),result=await diagnoseMetaConnection(new MetaGraph(config,transport),'123','123|secret',{provider_account_id:'111',channel:'facebook',capabilities:{publishing:false,execution_enabled:false}},'token-secret',guard);
  expect(result.token).toMatchObject({valid:true,type:'PAGE',app_matches:true,profile_matches:true});expect(result.credential_identity_matches).toBe(true);
  expect(result.evidence[2]).toMatchObject({check:'facebook_sync',endpoint:'111/posts',http_status:403,graph_error_code:10,graph_error_subcode:2018336,error_permissions:['pages_read_user_content']});
  expect(result.evidence.find(r=>r.check==='facebook_posts_minimal')?.success).toBe(true);
  for(const forbidden of ['token-secret','private-name','private-caption','private-subject','unknown-private-scope','123|secret'])expect(JSON.stringify(result)).not.toContain(forbidden);
  expect(transport.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);expect(guard).toHaveBeenCalledTimes(8);
 });
 it('does not probe optional fields when even minimal posts are denied',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(response({data:{is_valid:false,type:'USER',app_id:'999'}})).mockResolvedValueOnce(response({id:'personal-subject'}))
   .mockResolvedValue(response({error:{code:190,error_subcode:463,message:'token-secret'}},400));
  const result=await diagnoseMetaConnection(new MetaGraph(config,transport),'123','app-token',{provider_account_id:'111',channel:'facebook'},'token-secret',vi.fn());
  expect(result.token).toMatchObject({valid:false,type:'USER',app_matches:false});expect(result.credential_identity_matches).toBe(false);
  expect(transport).toHaveBeenCalledTimes(4);expect(JSON.stringify(result)).not.toContain('personal-subject');
 });
 it('does not call Meta when authority or generation guard fails',async()=>{
  const transport=vi.fn();await expect(diagnoseMetaConnection(new MetaGraph(config,transport),'123','app-token',{provider_account_id:'111',channel:'facebook'},'token',async()=>{throw new Error('scope revoked');})).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
 });
 it('checks Instagram through the retained Page identity without inferring publishing tasks',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(response({data:{is_valid:true,app_id:'123',type:'PAGE',profile_id:'111',user_id:'789',scopes:['instagram_basic','instagram_content_publish','pages_read_engagement'],expires_at:0}}))
   .mockResolvedValueOnce(response({id:'111'})).mockResolvedValueOnce(response({data:[]}))
   .mockResolvedValueOnce(response({id:'111',can_post:true})).mockResolvedValueOnce(response({error:{code:100,message:'private-subject unknown tasks field'}},400))
   .mockResolvedValueOnce(response({id:'111',instagram_business_account:{id:'333'}})).mockResolvedValueOnce(response({id:'333'}))
   .mockResolvedValueOnce(response({data:[{quota_usage:0,config:{quota_total:100}}]}));
  const connection={provider_account_id:'333',channel:'instagram',capabilities:{publishing:false,execution_enabled:false}},before=JSON.stringify(connection),guard=vi.fn();
  const result=await diagnoseMetaConnection(new MetaGraph(config,transport),'123','app-token',connection,'token-secret',guard,true);
  expect(result.credential_identity_matches).toBe(true);expect(result.publishing_evidence).toMatchObject({eligibility:'unverified',page_id:'111',can_post:true,page_tasks_verified:false,professional_account_verified:true,quota_usage:0,quota_total:100,missing_scopes:[],blockers:['page_tasks_unverified']});
  expect(result.publishing_enabled).toBe(false);expect(JSON.stringify(connection)).toBe(before);expect(guard).toHaveBeenCalledTimes(8);
  expect(transport.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
  expect(result.evidence.find(r=>r.check==='authorizer_page_roles')).toMatchObject({http_status:400,graph_error_code:100});
  for(const forbidden of ['token-secret','private-subject','app-token'])expect(JSON.stringify(result)).not.toContain(forbidden);
 });
 it('does not inspect an unrelated Instagram account or use a wrong-app token for Page probes',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(response({data:{is_valid:true,app_id:'123',type:'PAGE',user_id:'789',expires_at:0}})).mockResolvedValueOnce(response({id:'111'})).mockResolvedValueOnce(response({data:[]}))
   .mockResolvedValueOnce(response({id:'111',can_post:true})).mockResolvedValueOnce(response({id:'111'})).mockResolvedValueOnce(response({id:'111',instagram_business_account:{id:'999'}}));
  const result=await diagnoseMetaConnection(new MetaGraph(config,transport),'123','app-token',{provider_account_id:'333',channel:'instagram'},'token',vi.fn(),true);
  expect(result.credential_identity_matches).toBe(false);expect(result.publishing_evidence.blockers).toContain('credential_account_unverified');expect(transport).toHaveBeenCalledTimes(6);
  const invalid=vi.fn().mockResolvedValueOnce(response({data:{is_valid:true,app_id:'999',type:'PAGE',expires_at:0}})).mockResolvedValueOnce(response({id:'111'})).mockResolvedValueOnce(response({data:[]}));
  const denied=await diagnoseMetaConnection(new MetaGraph(config,invalid),'123','app-token',{provider_account_id:'111',channel:'facebook'},'token',vi.fn(),true);
  expect(denied.publishing_evidence.blockers).toContain('page_credential_unverified');expect(invalid).toHaveBeenCalledTimes(3);
 });
 it('requires verified Page token, application, identity, expiry and core read before retry',()=>{
  const connection={channel:'facebook',status:'error',error_code:'meta_permission_or_token_invalid',provider_account_id:'111',expires_at:'2099-01-01'};
  const result={account_id:'111',token:{valid:true,app_matches:true,type:'PAGE',expiry_in_future:true},credential_identity_matches:true,evidence:[{check:'facebook_sync',success:true}]};
  expect(verifiedFacebookRead(result,connection)).toBe(true);
  for(const patch of [{valid:false},{app_matches:false},{type:'USER'},{expiry_in_future:false}])expect(verifiedFacebookRead({...result,token:{...result.token,...patch}},connection)).toBe(false);
  for(const patch of [{credential_identity_matches:false},{account_id:'999'},{evidence:[{check:'facebook_sync',success:false}]}])expect(verifiedFacebookRead({...result,...patch},connection)).toBe(false);
  expect(verifiedFacebookRead(result,{...connection,channel:'instagram'})).toBe(false);
 });
 it('can verify actual content tasks without changing execution, but rejects a different granular target',async()=>{
  for(const targets of [null,['999']]) {
   const transport=vi.fn().mockResolvedValueOnce(response({data:{is_valid:true,app_id:'123',type:'PAGE',user_id:'789',scopes:['pages_manage_posts','pages_read_engagement'],expires_at:0,granular_scopes:targets?[{scope:'pages_manage_posts',target_ids:targets}]:[]}}))
    .mockResolvedValueOnce(response({id:'111'})).mockResolvedValueOnce(response({data:[]})).mockResolvedValueOnce(response({id:'111',can_post:true}))
    .mockResolvedValueOnce(response({data:[{id:'789',is_active:true,tasks:['CREATE_CONTENT']}]}));
   const connection={provider_account_id:'111',channel:'facebook',capabilities:{publishing:false,execution_enabled:false}},before=JSON.stringify(connection);
   const result=await diagnoseMetaConnection(new MetaGraph(config,transport),'123','app-token',connection,'secret-token',vi.fn(),true);
   expect(result.publishing_evidence.page_tasks_verified).toBe(true);expect(result.publishing_evidence.eligibility).toBe(targets?'unverified':'verified');
   expect(result.publishing_enabled).toBe(false);expect(JSON.stringify(connection)).toBe(before);
   expect(JSON.stringify(result)).not.toContain('789');
  }
 });
});
