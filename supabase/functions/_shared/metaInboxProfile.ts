import { MetaError, type MetaGraph } from './metaGraph.ts';
import { connectionBinding, unseal } from './metaSecurity.ts';
// Minimal official profile projection; identity always comes from the canonical conversation.
export function profileFields(channel: string) {
  if (channel === "instagram") return "name,username,profile_pic";
  if (channel === "facebook") return "first_name,last_name,profile_pic";
  throw new Error("profile_channel_unavailable");
}
export function sanitizeInboxProfile(
  value: Record<string, unknown>,
  channel: string,
) {
  const text = (v: unknown) =>
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .trim()
          .slice(0, 160) || null
      : null;
  const name =
    channel === "instagram"
      ? text(value.name)
      : text(
          [text(value.first_name), text(value.last_name)]
            .filter(Boolean)
            .join(" "),
        );
  const handle = channel === "instagram" ? text(value.username) : null;
  let avatar = null;
  try {
    const url = new URL(String(value.profile_pic));
    if (
      url.protocol === "https:" &&
      ["fbcdn.net", "cdninstagram.com", "fbsbx.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      ) &&
      url.href.length <= 2048 && !url.hash && !url.username && !url.password &&
      ![...url.searchParams.keys()].some(k => /access_token|appsecret_proof/i.test(k))
    )
      avatar = url.href;
  } catch {}
  return {
    display_name: name,
    handle,
    avatar_url: avatar,
    source: "meta_user_profile",
    available: Boolean(name || handle || avatar),
  };
}

async function profileRpc(db:any,name:string,args:Record<string,unknown>={}) {
  const {data,error}=await db.rpc(name,args);
  if(error)throw new Error('profile_authority_unavailable');
  return data;
}
export async function resolveInboxProfile(db:any,graph:MetaGraph,keys:string[],claim:any,id:string) {
  if(!claim?.lease)return claim?.profile || {available:false};
  const m=claim.material, connection=m.connection;
  let profile:Record<string,unknown>={}, diagnostic:Record<string,unknown>={status:'unavailable',reason:'profile_not_available',graph_version:graph.version};
  try {
    const credential=await unseal(connection.sealed_token,keys,connectionBinding(connection));
    const result=await graph.request(m.peer,credential.token,{fields:profileFields(connection.channel)},'GET',(status,code,evidence)=>{
      diagnostic={...diagnostic,http_status:status,graph_code:code,graph_subcode:evidence?.graph_error_subcode??null,...evidence?.profile_error};
    });
    profile=sanitizeInboxProfile(result,connection.channel);
    diagnostic={...diagnostic,status:profile.available?'resolved':'unavailable',reason:profile.available?'official_profile':'provider_returned_no_profile'};
  } catch(error) {
    diagnostic={...diagnostic,status:error instanceof MetaError&&[10,100,200,190].includes(error.graphCode||0)?'denied':'unavailable',reason:error instanceof MetaError?error.code:'profile_credential_unavailable'};
  }
  // Authority revalidates the exact peer, account, generation, employee and lease after the read.
  return await profileRpc(db,'marketing_inbox_profile_finish',{p_conversation:id,p_lease:claim.lease,p_generation:m.generation,p_profile:profile,p_diagnostic:diagnostic}) || {available:false};
}
export async function enrichInboxProfile(db:any,graph:MetaGraph,keys:string[],id:string,authUser:string) {
  return resolveInboxProfile(db,graph,keys,await profileRpc(db,'marketing_inbox_profile_claim',{p_conversation:id,p_auth_user:authUser}),id);
}
export async function runInboxProfile(db:any,graph:MetaGraph,keys:string[]) {
  const claim=await profileRpc(db,'marketing_inbox_profile_next');
  if(!claim)return false;
  await resolveInboxProfile(db,graph,keys,claim,claim.conversation_id);
  return true;
}
