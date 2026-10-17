import { it, expect, vi } from 'vitest';
import { MetaGraph } from '../../../../supabase/functions/_shared/metaGraph.ts';
import { enrichInboxProfile, resolveInboxProfile, runInboxProfile } from '../../../../supabase/functions/_shared/metaInboxProfile.ts';
import { seal, connectionBinding } from '../../../../supabase/functions/_shared/metaSecurity.ts';
import { webcrypto } from 'node:crypto';
import {
  profileFields,
  sanitizeInboxProfile,
} from "../../../../supabase/functions/_shared/metaInboxProfile.ts";
function assert(v: unknown) {
  if (!v) throw new Error("profile contract failed");
}
it(
  "profile reads use only official minimal fields and cannot request a different channel",
  () => {
    assert(profileFields("instagram") === "name,username,profile_pic");
    assert(profileFields("facebook") === "first_name,last_name,profile_pic");
    let failed = false;
    try {
      profileFields("internal");
    } catch {
      failed = true;
    }
    assert(failed);
  },
);
it(
  "profile projection preserves unavailable fields and excludes unrelated data and unsafe URLs",
  () => {
    const result = sanitizeInboxProfile(
      {
        name: null,
        username: "real_customer",
        profile_pic:
          "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=example",
        gender: "secret",
        id: "private",
      },
      "instagram",
    );
    assert(
      result.display_name === null &&
        result.handle === "real_customer" &&
        result.available &&
        !("gender" in result) &&
        !("id" in result),
    );
    assert(
      sanitizeInboxProfile(
        { profile_pic: "https://attacker.invalid/avatar" },
        "facebook",
      ).avatar_url === null,
    );
    assert(
      sanitizeInboxProfile(
        {
          first_name: "Actual",
          last_name: "Name",
          profile_pic: "https://cdn.fbcdn.net/avatar?access_token=secret",
        },
        "facebook",
      ).avatar_url === null,
    );
    assert(sanitizeInboxProfile({}, "facebook").available === false);
  },
);

it('retains no access-token-bearing avatar, even with case variants or fragments',()=>{
 for(const url of ['https://x.fbcdn.net/a?Access_Token=x','https://x.fbcdn.net/a#secret','https://user@x.fbcdn.net/a'])expect(sanitizeInboxProfile({profile_pic:url},'facebook').avatar_url).toBeNull();
});
it('cached results skip provider reads and canonical writes',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{profile:{available:true,display_name:'Verified'}}});
 const request=vi.fn();
 expect(await enrichInboxProfile({rpc},{request} as any,[],'conversation','actor')).toEqual({available:true,display_name:'Verified'});
 expect(request).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
});
it('binds successful official profile persistence to exact material, generation and lease',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 try {
  const key=Buffer.alloc(32,4).toString('base64');
  const connection={id:'connection',organization_id:'org',brand_id:'brand',channel:'facebook',external_account_id:'111',credential_generation:7};
  const sealed_token=await seal({token:'private-token'},key,connectionBinding(connection));
  const finish=vi.fn().mockResolvedValue({data:{available:true,display_name:'Actual Person'}});
  const request=vi.fn().mockImplementation(async(peer,token,params,method,inspect)=>{expect(peer).toBe('222');expect(token).toBe('private-token');inspect(200,null);return {first_name:'Actual',last_name:'Person'};});
  const result=await resolveInboxProfile({rpc:finish},{request,version:'v26.0'} as any,[key],{lease:'ticket',material:{connection:{...connection,sealed_token},peer:'222',generation:7}},'conversation');
  expect(result.display_name).toBe('Actual Person');
  expect(finish.mock.calls[0][1]).toMatchObject({p_conversation:'conversation',p_lease:'ticket',p_generation:7,p_profile:{display_name:'Actual Person'},p_diagnostic:{status:'resolved',http_status:200}});
  expect(JSON.stringify(finish.mock.calls)).not.toContain('private-token');
 }finally{vi.unstubAllGlobals();}
});
it('records bounded redacted provider denial only for exact official profile reads',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 try {
  let evidence:any;
  const graph=new MetaGraph({appId:'123',appSecret:'app-secret',configId:'456',version:'v26.0'},async()=>new Response(JSON.stringify({error:{code:10,error_subcode:2018001,message:'Requires Business Asset User Profile Access for 222 token-secret https://docs.example/path',fbtrace_id:'trace123'}}),{status:400}));
  await expect(graph.request('222','token-secret',{fields:'first_name,last_name,profile_pic'},'GET',(status,code,detail)=>evidence={status,code,...detail})).rejects.toThrow();
  expect(evidence).toMatchObject({status:400,code:10,graph_error_subcode:2018001,profile_error:{fbtrace_id:'trace123'}});
  expect(evidence.profile_error.message).toContain('Business Asset User Profile Access');
  expect(JSON.stringify(evidence)).not.toMatch(/token-secret|https:|222/);
 }finally{vi.unstubAllGlobals();}
});

it('idle historical enrichment skips provider work when no due authorized peer exists',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:null});const request=vi.fn();
 expect(await runInboxProfile({rpc},{request} as any,[])).toBe(false);
 expect(rpc).toHaveBeenCalledWith('marketing_inbox_profile_next',{});expect(request).not.toHaveBeenCalled();
});
