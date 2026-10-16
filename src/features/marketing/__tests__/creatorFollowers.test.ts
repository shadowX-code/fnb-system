import {beforeEach,it,expect,vi} from 'vitest';
import {readCreatorFollowers,runCreatorFollowers} from '../../../../supabase/functions/_shared/metaCreatorProfile.ts';
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',()=>({connectionBinding:()=> 'bound',unseal:async()=>({token:'server-only'})}));
let graph:any,material:any,account:any;
beforeEach(()=>{graph={request:vi.fn()};material={provider_account_id:'123',capabilities:{granted_scopes:['instagram_basic','instagram_manage_insights','pages_read_engagement']}};account={platform:'instagram',handle:'food',external_id:''}});
it('accepts real zero only from an exact API identity and rejects missing/string counts',async()=>{
 graph.request.mockResolvedValue({business_discovery:{id:'456',username:'food',followers_count:0}});expect(await readCreatorFollowers(graph,account,material,'token')).toMatchObject({status:'ready',count:0,source:'meta_instagram_business_discovery'});
 graph.request.mockResolvedValue({business_discovery:{id:'456',username:'food'}});expect(await readCreatorFollowers(graph,account,material,'token')).toMatchObject({status:'unavailable',reason:'followers_not_returned'});
 graph.request.mockResolvedValue({business_discovery:{id:'456',username:'other',followers_count:3}});expect(await readCreatorFollowers(graph,account,material,'token')).toMatchObject({reason:'provider_identity_mismatch'});
});
it('reads Facebook followers, never substitutes Page likes',async()=>{
 account={platform:'facebook',handle:'food'};graph.request.mockResolvedValue({id:'456',username:'food',fan_count:100});expect(await readCreatorFollowers(graph,account,material,'token')).toMatchObject({reason:'followers_not_returned'});
 graph.request.mockResolvedValue({id:'456',username:'food',followers_count:5});expect(await readCreatorFollowers(graph,account,material,'token')).toMatchObject({count:5,source:'meta_facebook_page'});
});
it.each(['tiktok','xhs'])('never falls back to scraping for %s',async platform=>{expect(await readCreatorFollowers(graph,{platform},material,'token')).toMatchObject({status:'unsupported'});expect(graph.request).not.toHaveBeenCalled()});
it('does not read Meta without required grants',async()=>{material.capabilities.granted_scopes=[];expect(await readCreatorFollowers(graph,account,material,'token')).toMatchObject({reason:'meta_permission_required'});expect(graph.request).not.toHaveBeenCalled()});
it('one claimed lease results in one bounded read and sanitized failure completion',async()=>{
 const claimed={...account,id:'a',organization_id:'org',connection_id:'c',connection_brand:'brand',connection_generation:1,followers_lease:'lease'};
 const db={rpc:vi.fn(async(name:string)=>({data:name==='marketing_creator_followers_claim'?claimed:name==='marketing_meta_connection_material'?{...material,id:'c',organization_id:'org',brand_id:'brand',channel:'instagram',credential_generation:1,status:'test_authorized',expires_at:'2099-01-01'}:true,error:null}))};
 graph.request.mockRejectedValue({code:'meta_error_100',message:'secret-token'});expect(await runCreatorFollowers(db,graph,['key'])).toBe(true);expect(graph.request).toHaveBeenCalledOnce();
 expect(db.rpc).toHaveBeenLastCalledWith('marketing_creator_followers_finish',expect.objectContaining({p_count:null,p_status:'unavailable',p_reason:'profile_not_available_with_current_meta_access',p_lease:'lease'}));expect(JSON.stringify(db.rpc.mock.calls)).not.toContain('secret-token');
});
it('skips provider reads when no account was claimed',async()=>{const db={rpc:vi.fn(async()=>({data:null,error:null}))};expect(await runCreatorFollowers(db,graph,[])).toBe(false);expect(graph.request).not.toHaveBeenCalled()});

it('reports the provider-confirmed public Page feature dependency without treating likes as followers',async()=>{
 account={platform:'facebook',handle:'publicpage'};
 graph.request.mockImplementation(async(_path:any,_token:any,_params:any,_method:any,inspect:any)=>{inspect(400,100,{page_error:{message:"This endpoint requires the Page Public Metadata Access feature"}});throw {code:'meta_error_100'};});
 expect(await readCreatorFollowers(graph,account,material,'token')).toEqual({status:'unavailable',reason:'facebook_public_page_access_required'});
 graph.request.mockImplementation(async(_path:any,_token:any,_params:any,_method:any,inspect:any)=>{inspect(400,190,{page_error:{message:'Token expired'}});throw {code:'meta_permission_or_token_invalid'};});
 await expect(readCreatorFollowers(graph,account,material,'token')).rejects.toMatchObject({code:'meta_permission_or_token_invalid'});
});
it('accepts the managed Page identity through the normal adapter',async()=>{
 graph.request.mockResolvedValue({id:'113234221623434',followers_count:4226,fan_count:4226});
 expect(await readCreatorFollowers(graph,{platform:'facebook',external_id:'113234221623434'},material,'token')).toEqual({status:'ready',count:4226,source:'meta_facebook_page'});
});
