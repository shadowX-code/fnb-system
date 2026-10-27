import {beforeEach,expect,it,vi} from 'vitest';
import {executeCreatorEnrichment,readCreatorProfile,runCreatorFollowers} from '../../../../supabase/functions/_shared/metaCreatorProfile.ts';
const {unseal}=vi.hoisted(()=>({unseal:vi.fn()}));
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',async importActual=>({...await importActual<any>(),unseal}));
const request='33333333-3333-4333-8333-333333333333',org='11111111-1111-4111-8111-111111111111',account='44444444-4444-4444-8444-444444444444';
const material={id:'connection',organization_id:org,brand_id:'private-brand',channel:'instagram',provider_account_id:'12345',account_name:'source',credential_generation:5,purpose:'public_instagram_creator_enrichment',request_id:request,handle:'target',sealed_token:{synthetic:true}};
let service:any,caller:any,graph:any;
beforeEach(()=>{
 vi.clearAllMocks();unseal.mockResolvedValue({token:'synthetic-test-only'});
 caller={rpc:vi.fn(async name=>({data:name==='marketing_creator_enrichment_begin'?{eligible:true,request_id:request}:null}))};
 service={rpc:vi.fn(async(name,args)=>({data:name==='marketing_creator_enrichment_material'?material:{state:'ready',observation:{source:'Meta Instagram Business Discovery',captured_at:'2026-10-28T00:00:00Z',profile_url:'https://www.instagram.com/target/',avatar_kind:'profile_picture',avatar_url:'https://scontent.cdninstagram.com/picture.jpg'},enrichment_receipt:request,account:{id:account}}}))};
 graph={request:vi.fn(async()=>({business_discovery:{id:'98765',username:'target',profile_picture_url:'https://scontent.cdninstagram.com/picture.jpg',followers_count:0}}))};
});
it('uses the delegated request before and after decrypt, one public-only GET, and the atomic server commit',async()=>{
 const result=await readCreatorProfile(caller,service,'user',graph,['test-key'],{org,handle:'target',account_id:account});
 expect(result).toMatchObject({metadata_status:'public_extracted',account:{id:account}});
 expect(caller.rpc).toHaveBeenCalledWith('marketing_creator_enrichment_begin',{p_org:org,p_handle:'target',p_account:account});
 expect(service.rpc.mock.calls.filter(([n])=>n==='marketing_creator_enrichment_material')).toHaveLength(2);
 expect(graph.request).toHaveBeenCalledExactlyOnceWith('12345','synthetic-test-only',{fields:'business_discovery.username(target){id,username,profile_picture_url,followers_count}'});
 expect(service.rpc).toHaveBeenCalledWith('marketing_creator_enrichment_finish',expect.objectContaining({p_request:request,p_auth_user:'user',p_observation:{id:'98765',username:'target',avatar_url:'https://scontent.cdninstagram.com/picture.jpg',followers:0}}));
 expect(JSON.stringify(result)).not.toMatch(/synthetic-test-only|sealed_token|private-brand/);
});
it('keeps missing delegation default-deny without credential, provider or quota access',async()=>{
 caller.rpc.mockResolvedValue({data:{eligible:false,reason:'organization_profile_authorization_required'}});
 expect(await readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target'})).toEqual({applicable:false,reason:'organization_profile_authorization_required'});
 expect(service.rpc).not.toHaveBeenCalled();expect(graph.request).not.toHaveBeenCalled();expect(caller.rpc).toHaveBeenCalledTimes(1);
});
it('rejects rotation or revocation during asynchronous decrypt before any provider request',async()=>{
 service.rpc.mockResolvedValueOnce({data:material}).mockResolvedValueOnce({error:{code:'42501'}});
 expect(await executeCreatorEnrichment(service,graph,[],request,'user')).toMatchObject({state:'failed',reason:'organization_profile_authorization_required'});expect(graph.request).not.toHaveBeenCalled();
});
it('discards a late provider response when the server commit reports revoked authority',async()=>{
 service.rpc.mockImplementation(async name=>name==='marketing_creator_enrichment_material'?{data:material}:{error:{code:'42501'}});
 expect(await executeCreatorEnrichment(service,graph,[],request,'user')).toMatchObject({state:'failed',reason:'organization_profile_authorization_required'});
 expect(graph.request).toHaveBeenCalledTimes(1);
});
it.each([{id:'98765',username:'other',followers_count:1},{id:'98765',username:'target',followers_count:-1},{id:'98765',username:'target',profile_picture_url:'https://private.example/photo.jpg',followers_count:1},{id:'98765',username:'target',profile_picture_url:'https://scontent.cdninstagram.com/a.jpg?access_token=bad'}])('rejects mismatched/invalid public data without a successful result commit: %j',async profile=>{
 graph.request.mockResolvedValue({business_discovery:profile});await executeCreatorEnrichment(service,graph,[],request,'user');
 expect(service.rpc.mock.calls.filter(([n,a])=>n==='marketing_creator_enrichment_finish'&&a.p_observation)).toHaveLength(0);
});
it('accepts count-only partial results without inventing an avatar',async()=>{
 graph.request.mockResolvedValue({business_discovery:{id:'98765',username:'target',followers_count:7}});await executeCreatorEnrichment(service,graph,[],request,'user');
 expect(service.rpc).toHaveBeenCalledWith('marketing_creator_enrichment_finish',expect.objectContaining({p_observation:{id:'98765',username:'target',followers:7}}));
});
it('routes the existing worker lease through the same purpose authority and commit',async()=>{
 const rpc=service.rpc;service.rpc=vi.fn(async(name,args)=>name==='marketing_creator_followers_claim'?{data:{enrichment_request_id:request}}:rpc(name,args));
 expect(await runCreatorFollowers(service,graph,[])).toBe(true);expect(service.rpc).toHaveBeenCalledWith('marketing_creator_enrichment_material',{p_request:request,p_auth_user:null});
 expect(service.rpc).not.toHaveBeenCalledWith('marketing_meta_connection_material',expect.anything());
});
