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

// Follower evidence is API-only: no HTML, browser, staff or paid fallback.
export async function readCreatorFollowers(graph:any,account:any,material:any,token:string){
 const scopes=material.capabilities?.granted_scopes||[];
 const unavailable=(reason:string,status='unavailable')=>({status,reason});
 if(!scopes.includes('pages_read_engagement'))return unavailable('meta_permission_required');
 if(account.platform==='instagram'){
  if(!scopes.includes('instagram_basic')||!scopes.includes('instagram_manage_insights'))return unavailable('instagram_permissions_required');
  if(!/^[a-z\d._]{1,30}$/.test(account.handle||''))return unavailable('instagram_username_required');
  const response=await graph.request(material.provider_account_id,token,{fields:`business_discovery.username(${account.handle}){id,username,followers_count}`});
  const profile=response.business_discovery;
  if(String(profile?.username||'').toLowerCase()!==account.handle.toLowerCase()||!/^\d+$/.test(String(profile?.id||'')))return unavailable('provider_identity_mismatch');
  if(account.identity_verified&&account.external_id&&String(profile.id)!==account.external_id)return unavailable('provider_identity_mismatch');
  return validCount(profile.followers_count,'meta_instagram_business_discovery');
 }
 if(account.platform==='facebook'){
  const target=/^\d+$/.test(account.external_id||'')?account.external_id:account.handle;
  if(!/^[a-z\d._-]{1,160}$/i.test(target||''))return unavailable('facebook_page_identity_required');
  let profile:any,publicAccessRequired=false;
  try{profile=await graph.request(target,token,{fields:'id,username,link,followers_count'},'GET',(_status:number|null,code:number|null,evidence:any)=>{
   publicAccessRequired=[10,100,200].includes(code??0)&&/Page Public (?:Metadata|Content) Access/.test(evidence?.page_error?.message||'');
  });}catch(error){
   if(publicAccessRequired)return unavailable('facebook_public_page_access_required');
   throw error;
  }
  const handle=String(profile?.username||'').toLowerCase();
  let linkHandle='';try{const url=new URL(profile.link);if(['www.facebook.com','facebook.com'].includes(url.hostname))linkHandle=url.pathname.replace(/^\/|\/$/g,'').toLowerCase();}catch{}
  if(!/^\d+$/.test(String(profile?.id||''))||(/^\d+$/.test(target)?String(profile.id)!==target:![handle,linkHandle].includes(target.toLowerCase())))return unavailable('provider_identity_mismatch');
  return validCount(profile.followers_count,'meta_facebook_page');
 }
 return unavailable('creator_oauth_or_approved_profile_api_required','unsupported');
}
function validCount(count:unknown,source:string){
 return typeof count==='number'&&Number.isSafeInteger(count)&&count>=0&&count<=1e15?{status:'ready',count,source}:{status:'unavailable',reason:'followers_not_returned'};
}
export async function runCreatorFollowers(db:any,graph:any,keys:string[]){
 const rpc=async(name:string,args:any={})=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error('creator_followers_authority_rejected');return data;};
 const account=await rpc('marketing_creator_followers_claim');if(!account)return false;
 let result:any={status:'unavailable',reason:'authorized_brand_connection_required'};
 try{
  if(account.connection_id){
   const material=await rpc('marketing_meta_connection_material',{p_connection:account.connection_id});
   if(material.credential_generation!==account.connection_generation||material.organization_id!==account.organization_id||material.brand_id!==account.connection_brand||material.channel!==account.platform||!['test_authorized','production_authorized'].includes(material.status)||Date.parse(material.expires_at)<=Date.now())throw new Error('connection_changed');
   const credential=await unseal(material.sealed_token,keys,connectionBinding(material));
   result=await readCreatorFollowers(graph,account,material,credential.token);
  }
 }catch(error){
  const code=String(error?.code||'');
  result={status:/^meta_(permission_or_token_invalid|error_(10|100|200))$/.test(code)?'unavailable':'failed',reason:code==='meta_permission_or_token_invalid'?'meta_permission_or_token_invalid':code==='meta_error_100'||code==='meta_error_10'||code==='meta_error_200'?'profile_not_available_with_current_meta_access':/^meta_(?:error_\d+|response_uncertain|response_unreadable)$/.test(code)?code:'provider_read_failed'};
 }
 await rpc('marketing_creator_followers_finish',{p_account:account.id,p_lease:account.followers_lease,p_connection:account.connection_id,p_generation:account.connection_generation,p_count:result.count??null,p_source:result.source??null,p_status:result.status,p_reason:result.reason??null});
 return true;
}
