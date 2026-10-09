import { webcrypto } from 'node:crypto';
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest';
import { MetaGraph,MetaError } from '../../../../supabase/functions/_shared/metaGraph.ts';
const config={appId:'123',appSecret:'test-app-secret',configId:'456',version:'v26.0'};
const reply=(v:any,status=200)=>new Response(JSON.stringify(v),{status});
describe('official Meta OAuth adapter',()=>{
 beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>vi.unstubAllGlobals());
 it('derives capabilities from actual grants, page tasks and granular targets without exposing tokens in account metadata',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',expires_at:Math.floor(Date.now()/1000)+3600,scopes:['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish'],granular_scopes:[{scope:'pages_manage_posts',target_ids:['999']}]}}))
   .mockResolvedValueOnce(reply({data:[{id:'111',name:'QA Page',access_token:'page-token',tasks:['CREATE_CONTENT'],instagram_business_account:{id:'222',username:'qa_instagram'}}]}));
  const result=await new MetaGraph(config,transport).exchange('unit-test-code');
  expect(result.accounts[0].capabilities.publishing).toBe(false);expect(result.accounts[1].capabilities.publishing).toBe(true);
  expect(JSON.stringify(result.accounts)).not.toContain('page-token');expect(result.tokens['facebook:111']).toBe('page-token');
  const discoveryUrl=new URL(transport.mock.calls[3][0]);expect(discoveryUrl.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);expect(discoveryUrl.searchParams.has('access_token')).toBe(false);expect(transport.mock.calls[3][1].headers.Authorization).toBe('Bearer long');
 });
 it('rejects tokens from another app and expired grants',async()=>{
  for(const data of [{is_valid:true,app_id:'different',user_id:'789'},{is_valid:true,app_id:'123',user_id:'789',expires_at:1}]) {
   const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600})).mockResolvedValueOnce(reply({data}));
   await expect(new MetaGraph(config,transport).exchange('code')).rejects.toBeInstanceOf(MetaError);expect(transport).toHaveBeenCalledTimes(3);
  }
 });
 it('marks write timeouts uncertain and never exposes raw provider errors',async()=>{
  const transport=vi.fn().mockRejectedValue(new Error('secret-containing-network-error'));
  await expect(new MetaGraph(config,transport).request('111/feed','token',{message:'test'},'POST')).rejects.toMatchObject({uncertain:true,message:'meta_response_uncertain'});
  const denied=vi.fn().mockResolvedValue(reply({error:{code:190,message:'secret-containing-error'}},400));
  await expect(new MetaGraph(config,denied).request('111','token')).rejects.toMatchObject({message:'meta_permission_or_token_invalid',uncertain:false});
 });
 it('traces grants, declines, granular targets and every filtered candidate without credential or profile data',async()=>{
  const events:any[]=[],transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short-secret'})).mockResolvedValueOnce(reply({access_token:'long-secret',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',expires_at:Math.floor(Date.now()/1000)+3600,scopes:['pages_show_list','pages_manage_posts'],granular_scopes:[{scope:'pages_manage_posts',target_ids:['622626120924115']}]}}))
   .mockResolvedValueOnce(reply({data:[{permission:'pages_show_list',status:'granted'},{permission:'instagram_basic',status:'declined'},{permission:'read_insights',status:'expired'}]}))
   .mockResolvedValueOnce(reply({data:[{id:'622626120924115',name:'private-profile-name',tasks:['CREATE_CONTENT'],instagram_business_account:{id:'222',username:'private-handle'}},{id:'invalid-secret',access_token:'page-secret',tasks:['MANAGE']},{id:'333',access_token:'page-secret',tasks:['ANALYZE'],instagram_business_account:{id:'444',username:'private-handle'}}]}));
  const result=await new MetaGraph(config,transport,event=>events.push(event)).exchange('authorization-code-secret');
  expect(result.accounts.map(a=>a.id)).toEqual(['333','444']);
  expect(events.filter(e=>e.event==='page_candidate')).toEqual([
   expect.objectContaining({page_id:'622626120924115',tasks:['CREATE_CONTENT'],decision:'rejected_missing_page_token',instagram_id:'222'}),
   expect.objectContaining({page_id:null,decision:'rejected_invalid_page_id'}),
   expect.objectContaining({page_id:'333',decision:'accepted',instagram_id:'444'})]);
  expect(events).toContainEqual(expect.objectContaining({event:'graph_response',endpoint:'me/accounts',http_status:200,graph_error_code:null,returned_count:3}));
  expect(events).toContainEqual({event:'permission_status',status:'declined',scopes:['instagram_basic']});
  expect(events).toContainEqual({event:'granular_targets',scope:'pages_manage_posts',account_ids:['622626120924115']});
  for(const forbidden of ['short-secret','long-secret','page-secret','authorization-code-secret',config.appSecret,'private-profile-name','private-handle','invalid-secret','789'])expect(JSON.stringify(events)).not.toContain(forbidden);
 });
 it('distinguishes an empty provider list from FeedX rejections and records safe Graph errors',async()=>{
  for(const response of [reply({data:[]}),reply({error:{code:200,message:'raw-secret-error',error_data:{access_token:'secret'}}},403)]) {
   const events:any[]=[],transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
    .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list']}})).mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(response);
   await new MetaGraph(config,transport,e=>events.push(e)).exchange('code').catch(()=>null);
   expect(events.filter(e=>e.event==='page_candidate')).toHaveLength(0);
   expect(events).toContainEqual(expect.objectContaining(response.status===200?{event:'graph_response',endpoint:'me/accounts',http_status:200,returned_count:0}:{event:'graph_response',endpoint:'me/accounts',http_status:403,graph_error_code:200}));
   expect(JSON.stringify(events)).not.toContain('raw-secret-error');
   expect(events.some(e=>e.event===(response.status===200?'discovery_complete':'discovery_failed'))).toBe(true);
  }
 });
 it('keeps diagnostic failures and permission inspection failures from changing authorization behavior',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list']}})).mockResolvedValueOnce(reply({error:{code:10}},403)).mockResolvedValueOnce(reply({data:[]}));
  expect((await new MetaGraph(config,transport,()=>{throw new Error('logging unavailable');}).exchange('code')).accounts).toEqual([]);
 });
 it('keeps alternative lists diagnostic-only and accepts exact grant targets read-only without logging the personal subject',async()=>{
  const events:any[]=[],transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short-secret'})).mockResolvedValueOnce(reply({access_token:'long-secret',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list'],granular_scopes:[{scope:'pages_show_list',target_ids:['111']}]}}))
   .mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply({data:[]}))
   .mockResolvedValueOnce(reply({data:[{id:'111',tasks:['CREATE_CONTENT'],access_token:'page-secret',instagram_business_account:{id:'222'}}]}))
   .mockResolvedValueOnce(reply({id:'111',access_token:'page-secret',instagram_business_account:{id:'222'}}));
  const result=await new MetaGraph(config,transport,e=>events.push(e)).exchange('code');
  expect(result.accounts.map(a=>a.id)).toEqual(['111','222']);expect(result.tokens['facebook:111']).toBe('page-secret');
  expect(result.accounts.every(a=>a.capabilities.publishing===false&&a.capabilities.page_tasks_verified===false)).toBe(true);
  expect(events).toContainEqual(expect.objectContaining({event:'visibility_probe_candidate',endpoint:'authorized_user_accounts',page_id:'111',tasks:['CREATE_CONTENT'],page_token_available:true,instagram_id:'222'}));
  expect(events).toContainEqual(expect.objectContaining({event:'page_candidate',source:'granted_page_node',requested_page_id:'111',page_id:'111',decision:'accepted',tasks:[],instagram_id:'222'}));
  for(const secret of ['short-secret','long-secret','page-secret','789',config.appSecret])expect(JSON.stringify(events)).not.toContain(secret);
  expect(transport.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);
 });
 it('discovers only explicitly granted Page identities and never infers publishing tasks',async()=>{
  const scopes=['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish','read_insights','instagram_manage_insights'];
  const make=(value:any,grants:any=[{scope:'pages_show_list',target_ids:['111']}])=>vi.fn()
   .mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes,granular_scopes:grants}}))
   .mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply(value));
  const good=make({id:'111',access_token:'page-token',tasks:['MANAGE'],instagram_business_account:{id:'222'}});
  const result=await new MetaGraph(config,good).exchange('code');
  expect(result.accounts).toHaveLength(2);
  for(const account of result.accounts)expect(account.capabilities).toMatchObject({publishing:false,posts:true,insights:true,page_tasks_verified:false,discovery_path:'granted_page_node'});
  expect(JSON.stringify(result.accounts)).not.toContain('page-token');
  expect(new URL(good.mock.calls[4][0]).pathname).toBe('/v26.0/111');
  for(const value of [{id:'999',access_token:'page-token'},{id:'111'},{id:'111',access_token:''},{id:'invalid',access_token:'page-token'},{error:{code:200}}]) {
   const rejected=await new MetaGraph(config,make(value)).exchange('code');
   expect(rejected.accounts).toEqual([]);expect(rejected.tokens).toEqual({});
  }
  for(const grants of [[],[{scope:'pages_manage_posts',target_ids:['111']}],[{scope:'pages_show_list',target_ids:['not-a-numeric-id']}]] ) {
   const transport=make({id:'111',access_token:'page-token'},grants);
   expect((await new MetaGraph(config,transport).exchange('code')).accounts).toEqual([]);
   expect(transport).toHaveBeenCalledTimes(4);
  }
 });
 it('retains granular read restrictions on the direct grant fallback and rejects malformed enumeration',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list','pages_read_engagement','instagram_basic'],granular_scopes:[{scope:'pages_show_list',target_ids:['111']},{scope:'instagram_basic',target_ids:['999']}]}}))
   .mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply({id:'111',access_token:'page-token',instagram_business_account:{id:'222'}}));
  const result=await new MetaGraph(config,transport).exchange('code');
  expect(result.accounts[0].capabilities.posts).toBe(true);expect(result.accounts[1].capabilities.posts).toBe(false);
  const malformed=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list'],granular_scopes:[{scope:'pages_show_list',target_ids:['111']}]}}))
   .mockResolvedValueOnce(reply({data:{id:'111'}}));
  await expect(new MetaGraph(config,malformed).exchange('code')).rejects.toMatchObject({code:'account_discovery_invalid_response'});
  expect(malformed).toHaveBeenCalledTimes(4);
 });
 it('resolves direct-grant publishing through exact authorizer roles while preserving channel scope restrictions',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish'],granular_scopes:[{scope:'pages_show_list',target_ids:['111']},{scope:'pages_manage_posts',target_ids:['999']}]}}))
   .mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply({id:'111',access_token:'page-token',instagram_business_account:{id:'222'}}))
   .mockResolvedValueOnce(reply({data:[{id:'789',is_active:true,tasks:['CREATE_CONTENT']}]}));
  const result=await new MetaGraph(config,transport).exchange('code');
  expect(result.accounts[0].capabilities).toMatchObject({publishing:false,page_task_source:'page_roles',page_tasks_verified:true});
  expect(result.accounts[1].capabilities).toMatchObject({publishing:true,page_task_source:'page_roles',page_tasks:['CREATE_CONTENT']});
  expect(new URL(transport.mock.calls[5][0]).searchParams.get('uid')).toBe('789');
  expect(JSON.stringify(result.accounts)).not.toContain('789');expect(JSON.stringify(result.accounts)).not.toContain('page-token');
 });
 it('resolves business assignments using fresh User mapping and a Page token, preserving channel scope boundaries',async()=>{
  for(const mapping of [{id:'555',business:{id:'777'}},null]) {
   const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
    .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',type:'USER',user_id:'789',scopes:['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish','pages_manage_metadata'],granular_scopes:[{scope:'pages_show_list',target_ids:['111']},{scope:'pages_manage_posts',target_ids:['999']}]}}))
    .mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply({id:'111',access_token:'page-token',instagram_business_account:{id:'222'}}))
    .mockResolvedValueOnce(reply({data:[]})).mockResolvedValueOnce(reply({data:mapping?[mapping]:[]}))
    .mockResolvedValueOnce(reply({data:[{id:'555',tasks:['MANAGE']}]}));
   const result=await new MetaGraph(config,transport).exchange('code');
   expect(result.accounts[0].capabilities.publishing).toBe(false);
   expect(result.accounts[1].capabilities.publishing).toBe(Boolean(mapping));
   expect(JSON.stringify(result.accounts)).not.toMatch(/789|555|page-token/);
   if(mapping) {
    expect(result.authorizerAssignments['instagram:222']).toEqual({subject:'789',businessId:'777',businessUserId:'555'});
    expect(new URL(transport.mock.calls[6][0]).pathname).toBe('/v26.0/789/business_users');
    expect(transport.mock.calls[6][1].headers.Authorization).toBe('Bearer long');
    expect(new URL(transport.mock.calls[7][0]).searchParams.get('business')).toBe('777');
    expect(transport.mock.calls[7][1].headers.Authorization).toBe('Bearer page-token');
   }else expect(result.authorizerAssignments).toEqual({});
  }
 });

});
