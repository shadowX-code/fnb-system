import {expect,it,vi} from 'vitest';
import {readCreatorProfile} from '../../../../supabase/functions/_shared/metaCreatorProfile.ts';
const body={org:'11111111-1111-4111-8111-111111111111',brand:'22222222-2222-4222-8222-222222222222',handle:'happinesskopitiam'};
it('reports the actual missing tenant-level authorization without borrowing a Brand credential, quota or provider request',async()=>{
 const caller={rpc:vi.fn(async()=>({data:{eligible:false,reason:'organization_profile_authorization_required'}}))},service={rpc:vi.fn()},graph={request:vi.fn()};
 expect(await readCreatorProfile(caller,service,'user',graph,['key'],body)).toEqual({applicable:false,reason:'organization_profile_authorization_required'});
 expect(caller.rpc).toHaveBeenCalledExactlyOnceWith('marketing_creator_profile_connection',{p_org:body.org});expect(service.rpc).not.toHaveBeenCalled();expect(graph.request).not.toHaveBeenCalled();
});
it('fails closed for denied scope or an unexpected purported eligible contract',async()=>{
 const service={rpc:vi.fn()},graph={request:vi.fn()};
 for(const result of [{error:{code:'42501'}},{data:{eligible:true,connection_id:'brand-credential'}}]){
  await expect(readCreatorProfile({rpc:vi.fn(async()=>result)},service,'user',graph,[],body)).rejects.toThrow('creator_profile_scope_unavailable');
 }
 expect(service.rpc).not.toHaveBeenCalled();expect(graph.request).not.toHaveBeenCalled();
});
