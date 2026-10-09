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
});
