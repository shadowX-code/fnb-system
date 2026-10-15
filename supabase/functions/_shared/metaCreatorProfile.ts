import {connectionBinding,unseal} from './metaSecurity.ts';
// Official reads reuse existing Creator scope, connection authority and inspection quota.
export async function readCreatorProfile(caller:any,service:any,userId:string,graph:any,keys:string[],body:any){
 const {org,brand,handle}=body;
 if(!/^[a-f\d-]{36}$/i.test(org||'')||!/^[a-f\d-]{36}$/i.test(brand||'')||!/^[a-z\d._]{1,30}$/.test(handle||''))throw new Error('invalid_creator_profile');
 const rpc=async(db:any,name:string,args:any)=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error('creator_profile_scope_unavailable');return data;};
 const scope={p_org:org,p_brand:brand};
 await rpc(caller,'marketing_creator_directory',scope);
 let material:any;
 try{
  const data=await rpc(caller,'marketing_integrations',{...scope,p_surface:'settings',p_page:1});
  const connection=data.connections?.find((c:any)=>c.organization_id===org&&c.brand_id===brand&&c.channel==='instagram'&&['test_authorized','production_authorized'].includes(c.status)&&Date.parse(c.expires_at)>Date.now());
  if(!connection)return {applicable:false};
  material=await rpc(service,'marketing_meta_diagnostic_material',{p_connection:connection.id,p_auth_user:userId});
 }catch{return {applicable:false};}
 const scopes=material.capabilities?.granted_scopes||[];
 if(!['instagram_basic','pages_read_engagement','instagram_manage_insights'].every(s=>scopes.includes(s)))return {applicable:false};
 const credential=await unseal(material.sealed_token,keys,connectionBinding(material));
 const guard=async()=>{
  await rpc(caller,'marketing_creator_directory',scope);
  const current=await rpc(service,'marketing_meta_diagnostic_material',{p_connection:material.id,p_auth_user:userId});
  if(current.credential_generation!==material.credential_generation||current.provider_account_id!==material.provider_account_id||current.organization_id!==org||current.brand_id!==brand||!['test_authorized','production_authorized'].includes(current.status)||Date.parse(current.expires_at)<=Date.now())throw new Error('creator_profile_scope_unavailable');
 };
 let lease:any,httpStatus:number|null=null,providerCode:number|null=null;
 try{
  await guard();lease=await rpc(caller,'marketing_creator_inspection_access',{...scope,p_begin:true});
  const direct=String(material.account_name||'').replace(/^@/,'').toLowerCase()===handle;
  const fields=direct?'id,username,profile_picture_url':`business_discovery.username(${handle}){id,username,profile_picture_url}`;
  const response=await graph.request(material.provider_account_id,credential.token,{fields},'GET',(status:number|null,code:number|null)=>{httpStatus=status;providerCode=code;});
  await guard();const profile=direct?response:response.business_discovery;
  let avatar:URL;try{avatar=new URL(profile?.profile_picture_url);}catch{throw new Error('meta_profile_picture_unavailable');}
  if(String(profile?.username||'').toLowerCase()!==handle||!/^\d+$/.test(String(profile?.id||''))||avatar.protocol!=='https:'||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(avatar.hostname)||avatar.username||avatar.password||avatar.searchParams.has('access_token'))throw new Error('meta_profile_picture_unavailable');
  return {applicable:true,platform:'instagram',profile_url:`https://www.instagram.com/${handle}/`,handle,avatar_url:avatar.href,avatar_kind:'profile_picture',metadata_status:'public_extracted',identity_verified:false,captured_at:new Date().toISOString(),source:direct?'Meta Instagram account profile':'Meta Instagram Business Discovery',method:direct?'meta_ig_user':'meta_business_discovery'};
 }catch(error){
  // Safe provider codes only; never return credentials, raw errors or request URLs.
  const code=typeof error?.code==='string'&&/^meta_(?:permission_or_token_invalid|error_\d+|response_uncertain|response_unreadable)$/.test(error.code)?error.code:null;
  return {applicable:true,platform:'instagram',profile_url:`https://www.instagram.com/${handle}/`,metadata_status:'unavailable',reason:!lease?'inspection_unavailable':error?.message==='creator_profile_scope_unavailable'?'creator_profile_scope_unavailable':code||'meta_profile_unavailable',http_status:httpStatus,graph_error_code:providerCode,source:'Meta Instagram profile',unavailable:{profile:!lease?'Inspection access or quota is unavailable. No provider request was made.':error?.message==='creator_profile_scope_unavailable'?'Connection access changed. No picture was accepted.':code==='meta_permission_or_token_invalid'?'Meta did not authorize this profile read with the existing connection.':'Meta did not return an eligible matching profile picture. Initials remain available.'}};
 }finally{if(lease)await rpc(caller,'marketing_creator_inspection_access',{...scope,p_begin:false,p_lease:lease}).catch(()=>{});}
}
