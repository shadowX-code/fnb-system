import {connectionBinding,unseal} from './metaSecurity.ts';
// Credentials stay server-side and are usable here only through a request-bound public-read delegation.
async function enrichmentRpc(db:any,name:string,args:any){
 const {data,error}=await db.rpc(name,args);if(error)throw new Error('creator_enrichment_authority_changed');return data;
}
function publicObservation(profile:any,handle:string){
 if(String(profile?.username||'').toLowerCase()!==handle||!/^\d{1,40}$/.test(String(profile?.id||'')))throw new Error('provider_identity_mismatch');
 const observation:any={id:String(profile.id),username:handle};
 if(profile.profile_picture_url){
  let image:URL;try{image=new URL(profile.profile_picture_url)}catch{throw new Error('provider_profile_unavailable')}
  if(image.protocol!=='https:'||image.username||image.password||image.port||!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(image.hostname)||image.searchParams.has('access_token'))throw new Error('provider_profile_unavailable');
  observation.avatar_url=image.href;
 }
 if(profile.followers_count!=null){
  if(typeof profile.followers_count!=='number'||!Number.isSafeInteger(profile.followers_count)||profile.followers_count<0||profile.followers_count>1e15)throw new Error('provider_profile_unavailable');
  observation.followers=profile.followers_count;
 }
 if(!observation.avatar_url&&observation.followers==null)throw new Error('provider_profile_unavailable');
 return observation;
}
export async function executeCreatorEnrichment(service:any,graph:any,keys:string[],request:string,userId:string|null){
 try{
  const args={p_request:request,p_auth_user:userId};
  const material=await enrichmentRpc(service,'marketing_creator_enrichment_material',args);
  if(material?.purpose!=='public_instagram_creator_enrichment'||material.request_id!==request||material.channel!=='instagram')throw new Error('creator_enrichment_authority_changed');
  const credential=await unseal(material.sealed_token,keys,connectionBinding(material));
  // Recheck after asynchronous decryption and immediately before the only provider GET.
  const current=await enrichmentRpc(service,'marketing_creator_enrichment_material',args);
  if(current?.purpose!==material.purpose||current.request_id!==request||current.id!==material.id||current.credential_generation!==material.credential_generation||connectionBinding(current)!==connectionBinding(material))throw new Error('creator_enrichment_authority_changed');
  const direct=String(material.account_name||'').replace(/^@/,'').toLowerCase()===material.handle;
  const fields=direct?'id,username,profile_picture_url,followers_count':`business_discovery.username(${material.handle}){id,username,profile_picture_url,followers_count}`;
  const response=await graph.request(material.provider_account_id,credential.token,{fields});
  const observation=publicObservation(direct?response:response.business_discovery,material.handle);
  // This authority locks delegation + generation and atomically rejects late/stale responses.
  return await enrichmentRpc(service,'marketing_creator_enrichment_finish',{...args,p_observation:observation,p_error:null});
 }catch(error){
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
  const message=error instanceof Error?error.message:'';
  const reason=message==='creator_enrichment_authority_changed'?'organization_profile_authorization_required':code==='meta_permission_or_token_invalid'?code:['provider_identity_mismatch','provider_profile_unavailable'].includes(message)?message:'provider_read_failed';
  // Failure evidence is best effort. A revoked or rotated delegation must reject even this commit.
  await service.rpc('marketing_creator_enrichment_finish',{p_request:request,p_auth_user:userId,p_observation:null,p_error:reason}).catch(()=>{});
  return {state:'failed',reason};
 }
}
export async function readCreatorProfile(caller:any,service:any,userId:string,graph:any,keys:string[],body:any){
 const {org,handle,account_id=null}=body;
 if(!/^[a-f\d-]{36}$/i.test(org||'')||!/^[a-z\d._]{1,30}$/.test(handle||'')||(account_id!==null&&!/^[a-f\d-]{36}$/i.test(account_id)))throw new Error('invalid_creator_profile');
 const begin=await enrichmentRpc(caller,'marketing_creator_enrichment_begin',{p_org:org,p_handle:handle,p_account:account_id});
 if(begin?.eligible===false&&begin.reason==='organization_profile_authorization_required')return {applicable:false,reason:begin.reason};
 if(begin?.eligible!==true||!/^[a-f\d-]{36}$/i.test(begin.request_id||''))throw new Error('creator_profile_scope_unavailable');
 try{
  const result=await executeCreatorEnrichment(service,graph,keys,begin.request_id,userId);
  if(result?.state!=='ready')return {applicable:true,metadata_status:'unavailable',reason:result?.reason||'provider_read_failed',unavailable:{profile:result?.reason==='organization_profile_authorization_required'?'Workspace profile authorization changed. Saved details are retained.':'The authorized provider could not refresh this profile. Saved details are retained.'}};
  return {applicable:true,platform:'instagram',handle,identity_verified:false,metadata_status:'public_extracted',...result.observation,enrichment_receipt:result.enrichment_receipt,account:result.account};
 }finally{await caller.rpc('marketing_creator_inspection_access',{p_org:org,p_brand:null,p_begin:false,p_lease:begin.request_id}).catch(()=>{})}
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
 if(account.enrichment_request_id){await executeCreatorEnrichment(db,graph,keys,account.enrichment_request_id,null);return true;}
 let result:any={status:'unavailable',reason:'organization_profile_authorization_required'};
 try{
  if(account.connection_id){
   const material=await rpc('marketing_meta_connection_material',{p_connection:account.connection_id});
   if(material.credential_generation!==account.connection_generation||material.organization_id!==account.organization_id||material.brand_id!==null||material.capabilities?.creator_profile_authority!=='organization_explicit'||material.channel!==account.platform||!['test_authorized','production_authorized'].includes(material.status)||Date.parse(material.expires_at)<=Date.now())throw new Error('connection_changed');
   const credential=await unseal(material.sealed_token,keys,connectionBinding(material));
   result=await readCreatorFollowers(graph,account,material,credential.token);
  }
 }catch(error){
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
  result={status:/^meta_(permission_or_token_invalid|error_(10|100|200))$/.test(code)?'unavailable':'failed',reason:code==='meta_permission_or_token_invalid'?'meta_permission_or_token_invalid':code==='meta_error_100'||code==='meta_error_10'||code==='meta_error_200'?'profile_not_available_with_current_meta_access':/^meta_(?:error_\d+|response_uncertain|response_unreadable)$/.test(code)?code:'provider_read_failed'};
 }
 await rpc('marketing_creator_followers_finish',{p_account:account.id,p_lease:account.followers_lease,p_connection:account.connection_id,p_generation:account.connection_generation,p_count:result.count??null,p_source:result.source??null,p_status:result.status,p_reason:result.reason??null});
 return true;
}
