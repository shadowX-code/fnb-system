import {connectionBinding,unseal} from './metaSecurity.ts';
// Creator profiles are now shared. The existing Social OAuth contract is Brand-owned;
// it cannot delegate those credentials to a tenant-wide enrichment operation.
export async function readCreatorProfile(caller:any,_service:any,_userId:string,_graph:any,_keys:string[],body:any){
 const {org,handle}=body;
 if(!/^[a-f\d-]{36}$/i.test(org||'')||!/^[a-z\d._]{1,30}$/.test(handle||''))throw new Error('invalid_creator_profile');
 const {data,error}=await caller.rpc('marketing_creator_profile_connection',{p_org:org});
 if(error)throw new Error('creator_profile_scope_unavailable');
 if(data?.eligible!==false||data?.reason!=='organization_profile_authorization_required')throw new Error('creator_profile_scope_unavailable');
 return {applicable:false,reason:data.reason};
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
 let result:any={status:'unavailable',reason:'organization_profile_authorization_required'};
 try{
  if(account.connection_id){
   const material=await rpc('marketing_meta_connection_material',{p_connection:account.connection_id});
   if(material.credential_generation!==account.connection_generation||material.organization_id!==account.organization_id||material.brand_id!==null||material.capabilities?.creator_profile_authority!=='organization_explicit'||material.channel!==account.platform||!['test_authorized','production_authorized'].includes(material.status)||Date.parse(material.expires_at)<=Date.now())throw new Error('connection_changed');
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
