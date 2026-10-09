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
   expect(events.at(-1).event).toBe(response.status===200?'discovery_complete':'discovery_failed');
  }
 });
 it('keeps diagnostic failures and permission inspection failures from changing authorization behavior',async()=>{
  const transport=vi.fn().mockResolvedValueOnce(reply({access_token:'short'})).mockResolvedValueOnce(reply({access_token:'long',expires_in:3600}))
   .mockResolvedValueOnce(reply({data:{is_valid:true,app_id:'123',user_id:'789',scopes:['pages_show_list']}})).mockResolvedValueOnce(reply({error:{code:10}},403)).mockResolvedValueOnce(reply({data:[]}));
  expect((await new MetaGraph(config,transport,()=>{throw new Error('logging unavailable');}).exchange('code')).accounts).toEqual([]);
 });
});
