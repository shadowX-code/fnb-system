import {expect,it,vi} from 'vitest';
import {readCreatorProfile,runCreatorFollowers} from '../../../../supabase/functions/_shared/metaCreatorProfile.ts';
const body={org:'11111111-1111-4111-8111-111111111111',brand:'22222222-2222-4222-8222-222222222222',handle:'happinesskopitiam'};
it('reports the actual missing tenant-level authorization without borrowing a Brand credential, quota or provider request',async()=>{
 const caller={rpc:vi.fn(async()=>({data:{eligible:false,reason:'organization_profile_authorization_required'}}))},service={rpc:vi.fn()},graph={request:vi.fn()};
 expect(await readCreatorProfile(caller,service,'user',graph,['key'],body)).toEqual({applicable:false,reason:'organization_profile_authorization_required'});
 expect(caller.rpc).toHaveBeenCalledExactlyOnceWith('marketing_creator_enrichment_begin',{p_org:body.org,p_handle:body.handle,p_account:null});expect(service.rpc).not.toHaveBeenCalled();expect(graph.request).not.toHaveBeenCalled();
});
it('fails closed for denied scope or an unexpected purported eligible contract',async()=>{
 const service={rpc:vi.fn()},graph={request:vi.fn()};
 for(const result of [{error:{code:'42501'}},{data:{eligible:true,connection_id:'brand-credential'}}]){
  await expect(readCreatorProfile({rpc:vi.fn(async()=>result)},service,'user',graph,[],body)).rejects.toThrow(/creator_(?:profile_scope_unavailable|enrichment_authority_changed)/);
 }
 expect(service.rpc).not.toHaveBeenCalled();expect(graph.request).not.toHaveBeenCalled();
});

it('records a non-object provider failure without breaking the worker',async()=>{const db={rpc:vi.fn(async(name)=>({data:name==='marketing_creator_followers_claim'?{id:'a',connection_id:'c'}:null,error:null}))};db.rpc.mockImplementation(async name=>{if(name==='marketing_meta_connection_material')throw null;return {data:name==='marketing_creator_followers_claim'?{id:'a',connection_id:'c'}:null,error:null}});expect(await runCreatorFollowers(db,{},[])).toBe(true);expect(db.rpc.mock.calls.at(-1)[1]).toMatchObject({p_status:'failed',p_reason:'provider_read_failed'})});
