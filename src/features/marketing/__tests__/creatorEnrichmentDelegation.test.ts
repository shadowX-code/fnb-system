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
 expect(graph.request).toHaveBeenCalledExactlyOnceWith('12345','synthetic-test-only',{fields:'business_discovery.username(target){id,username,name,biography,website,media_count,profile_picture_url,followers_count}'},'GET',expect.any(Function));
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

// PostgREST builders are lazy PromiseLike values, not native Promises: they have no .catch().
function sdkRpc(implementation:any){return vi.fn((...args:any[])=>({then:(resolve:any,reject:any)=>Promise.resolve().then(()=>implementation(...args)).then(resolve,reject)}))}
it('acknowledges a committed refresh with actual SDK-shaped cleanup and a failing lease release',async()=>{
 const oldCaller=caller.rpc;caller.rpc=sdkRpc(async(name:any,args:any)=>{if(name==='marketing_creator_inspection_access')throw new Error('cleanup unavailable');return oldCaller(name,args)});
 const oldService=service.rpc;service.rpc=sdkRpc(oldService);
 await expect(readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target',account_id:account})).resolves.toMatchObject({metadata_status:'public_extracted',enrichment_receipt:request,account:{id:account}});
 expect(graph.request).toHaveBeenCalledTimes(1);expect(service.rpc.mock.calls.filter(([name,args]:any)=>name==='marketing_creator_enrichment_finish'&&args.p_observation)).toHaveLength(1);
});
it('records provider failure with a lazy SDK builder without throwing from best-effort failure evidence',async()=>{
 graph.request.mockRejectedValue(Object.assign(new Error('provider rejected'),{code:'meta_permission_or_token_invalid'}));
 const oldService=service.rpc;service.rpc=sdkRpc((name:any,args:any)=>name==='marketing_creator_enrichment_finish'?{error:{code:'42501'}}:oldService(name,args));
 await expect(readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target',account_id:account})).resolves.toMatchObject({metadata_status:'unavailable',reason:'meta_permission_or_token_invalid',failure_stage:'provider'});
 expect(graph.request).toHaveBeenCalledTimes(1);expect(service.rpc.mock.calls.filter(([name]:any)=>name==='marketing_creator_enrichment_finish')).toHaveLength(1);
});
it.each(['42501','40001','P0001'])('reports an explicit commit rejection %s without another finish or provider request',async code=>{
 service.rpc.mockImplementation(async(name:any)=>name==='marketing_creator_enrichment_material'?{data:material}:{error:{code}});
 const result=await readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target',account_id:account});
 expect(result).toMatchObject({metadata_status:'unavailable',failure_stage:'persistence'});expect(result).not.toHaveProperty('account');
 expect(graph.request).toHaveBeenCalledTimes(1);expect(service.rpc.mock.calls.filter(([name]:any)=>name==='marketing_creator_enrichment_finish')).toHaveLength(1);
});
it.each(['thrown','resolved'])('treats a %s lost persistence acknowledgement as uncertain without retry or failure overwrite',async kind=>{
 service.rpc.mockImplementation(async(name:any)=>{if(name==='marketing_creator_enrichment_material')return {data:material};if(kind==='thrown')throw new TypeError('transport lost');return {error:{code:'',message:'transport lost'}}});
 const result=await readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target',account_id:account});
 expect(result).toMatchObject({metadata_status:'uncertain',reason:'persistence_acknowledgement_unavailable',failure_stage:'persistence'});
 expect(result.unavailable.profile).toMatch(/may already be saved/);expect(result).not.toHaveProperty('account');
 expect(graph.request).toHaveBeenCalledTimes(1);expect(service.rpc.mock.calls.filter(([name]:any)=>name==='marketing_creator_enrichment_finish')).toHaveLength(1);
});

it.each([[100,'profile_not_available_with_current_meta_access'],[190,'meta_token_invalid'],[10,'meta_permission_required'],[4,'provider_rate_limited']])('retains Meta failure %s consistently for automatic/manual/worker persistence',async(code,reason)=>{
 graph.request.mockImplementation(async(_path:any,_token:any,_params:any,_method:any,inspect:any)=>{inspect(400,code,{graph_error_subcode:33});throw Object.assign(new Error('not exposed'),{code:`meta_error_${code}`,graphCode:code})});
 const result=await readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target'});
 expect(result).toMatchObject({metadata_status:'unavailable',reason,provider_evidence:{http_status:400,graph_error_code:code,graph_error_subcode:33}});
 expect(service.rpc).toHaveBeenCalledWith('marketing_creator_enrichment_finish',expect.objectContaining({p_error:reason,p_observation:null}));expect(graph.request).toHaveBeenCalledTimes(1);
});
it('does not invoke Meta when another request owns the same profile',async()=>{
 caller.rpc.mockResolvedValue({data:{eligible:false,reason:'profile_refresh_in_progress'}});
 expect(await readCreatorProfile(caller,service,'user',graph,[],{org,handle:'target'})).toMatchObject({reason:'profile_refresh_in_progress'});expect(graph.request).not.toHaveBeenCalled();
});
it('persists available public name and metadata with the same identity-bound receipt',async()=>{
 graph.request.mockResolvedValue({business_discovery:{id:'98765',username:'target',name:'Public name',biography:'Food creator',website:'https://example.com',media_count:42,followers_count:7}});
 await executeCreatorEnrichment(service,graph,[],request,'user');expect(service.rpc).toHaveBeenCalledWith('marketing_creator_enrichment_finish',expect.objectContaining({p_observation:{id:'98765',username:'target',name:'Public name',biography:'Food creator',website:'https://example.com',media_count:42,followers:7}}));
});
