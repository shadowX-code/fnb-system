import { webcrypto } from 'node:crypto';
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest';
import { MetaGraph } from '../../../../supabase/functions/_shared/metaGraph.ts';
import { diagnoseMetaConnection } from '../../../../supabase/functions/_shared/metaConnectionDiagnostics.ts';
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
});
