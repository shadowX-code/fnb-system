import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readCreatorProfile} from '../../../../supabase/functions/_shared/metaCreatorProfile.ts';
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',()=>({connectionBinding:()=> 'bound',unseal:async()=>({token:'server-only'})}));
const org='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222';
const body={org,brand,handle:'happinesskopitiam'};
let material:any,caller:any,service:any,graph:any;
beforeEach(()=>{
 material={id:'connection',organization_id:org,brand_id:brand,channel:'instagram',account_name:'holahola.kopitiam',provider_account_id:'123',credential_generation:1,status:'test_authorized',expires_at:'2099-01-01',capabilities:{granted_scopes:['instagram_basic','pages_read_engagement','instagram_manage_insights']}};
 caller={rpc:vi.fn(async(name:string,args:any)=>({data:name==='marketing_integrations'?{connections:[material]}:name==='marketing_creator_inspection_access'?(args.p_begin?'lease':null):{},error:null}))};
 service={rpc:vi.fn(async()=>({data:{...material},error:null}))};
 graph={request:vi.fn(async()=>({business_discovery:{id:'456',username:'happinesskopitiam',profile_picture_url:'https://scontent.cdninstagram.com/profile.jpg'}}))};
});
const run=()=>readCreatorProfile(caller,service,'user',graph,['key'],body);
describe('official Creator picture read authority',()=>{
 it('reads one exact professional profile under existing quota without leaking credentials',async()=>{
  const result=await run();expect(result).toMatchObject({applicable:true,avatar_kind:'profile_picture',method:'meta_business_discovery',handle:'happinesskopitiam'});
  expect(graph.request).toHaveBeenCalledWith('123','server-only',{fields:'business_discovery.username(happinesskopitiam){id,username,profile_picture_url}'},'GET',expect.any(Function));
  expect(caller.rpc).toHaveBeenCalledWith('marketing_creator_inspection_access',expect.objectContaining({p_begin:true}));expect(caller.rpc).toHaveBeenCalledWith('marketing_creator_inspection_access',expect.objectContaining({p_begin:false,p_lease:'lease'}));expect(JSON.stringify(result)).not.toContain('server-only');
 });
 it('uses the direct eligible account only for its exact matching username',async()=>{material.account_name='happinesskopitiam';graph.request.mockResolvedValue({id:'456',username:'happinesskopitiam',profile_picture_url:'https://scontent.cdninstagram.com/profile.jpg'});expect(await run()).toMatchObject({method:'meta_ig_user'});expect(graph.request).toHaveBeenCalledWith('123','server-only',{fields:'id,username,profile_picture_url'},'GET',expect.any(Function));});
 it('never borrows another brand connection or begins a quota lease for it',async()=>{material.brand_id='other';expect(await run()).toEqual({applicable:false});expect(graph.request).not.toHaveBeenCalled();expect(caller.rpc.mock.calls.some(([name]:any)=>name==='marketing_creator_inspection_access')).toBe(false);});
 it('requires existing connection configuration authority and granted scopes',async()=>{service.rpc.mockResolvedValue({error:{code:'42501'}});expect(await run()).toEqual({applicable:false});expect(graph.request).not.toHaveBeenCalled();});
 it('does not perform a provider read when quota denies the lease',async()=>{caller.rpc.mockImplementation(async(name:string)=>name==='marketing_creator_inspection_access'?{error:{code:'P0001'}}:{data:name==='marketing_integrations'?{connections:[material]}:{}});expect(await run()).toMatchObject({metadata_status:'unavailable'});expect(graph.request).not.toHaveBeenCalled();});
 it.each([{id:'456',username:'other',profile_picture_url:'https://scontent.cdninstagram.com/profile.jpg'},{id:'456',username:'happinesskopitiam',profile_picture_url:'https://example.com/post.jpg'}])('rejects unbound or unapproved media',async profile=>{graph.request.mockResolvedValue({business_discovery:profile});expect(await run()).toMatchObject({metadata_status:'unavailable'});});
 it('revalidates generation after provider read and does not return stale evidence',async()=>{graph.request.mockImplementation(async()=>{material.credential_generation++;return {business_discovery:{id:'456',username:'happinesskopitiam',profile_picture_url:'https://scontent.cdninstagram.com/profile.jpg'}};});expect(await run()).toMatchObject({metadata_status:'unavailable'});});
 it('retains only a safe provider error code and releases the lease',async()=>{graph.request.mockRejectedValue({code:'meta_error_100',message:'token=secret'});const result=await run();expect(result).toMatchObject({reason:'meta_error_100',metadata_status:'unavailable'});expect(JSON.stringify(result)).not.toContain('secret');expect(caller.rpc).toHaveBeenLastCalledWith('marketing_creator_inspection_access',expect.objectContaining({p_begin:false}));});
});
