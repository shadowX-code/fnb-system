import { MetaGraph, MetaError } from './metaGraph.ts';
import { META_SCOPES, hash } from './metaSecurity.ts';
import { facebookPostFields } from './metaSynchronization.ts';
import { resolvePageRoleTasks, resolveBusinessPageTasks, type AuthorizerAssignment, type OAuthTaskEvidence, resolveOAuthTaskEvidence, discoverAuthorizerAssignments } from './metaPageTasks.ts';
// Fixed GETs only. No provider bodies, messages, personal subjects or credentials leave this module.
export async function diagnoseMetaConnection(graph:MetaGraph,appId:string,appToken:string,connection:any,token:string,guard:()=>Promise<void>,publishingChecks=false,assignment?:AuthorizerAssignment, oauthEvidence?:OAuthTaskEvidence,onEvidence?:(e:OAuthTaskEvidence)=>Promise<void>) {
 const id=connection.provider_account_id;
 if(!/^\d{1,30}$/.test(id))throw new MetaError('invalid_meta_account');
 const evidence:any[]=[];
 const read=async(label:string,path:string,credential:string,params:any)=>{
  await guard();let item:any={check:label,endpoint:path==='debug_token'?'debug_token':path==='me'?'me':path.endsWith('/business_users')?'authorizer/business_users':path,http_status:null,graph_error_code:null,graph_error_subcode:null,error_permissions:[]};
  try {
   const value=await graph.request(path,credential,params,'GET',(status,code,detail)=>{item={...item,http_status:status,graph_error_code:code,...detail};});
   item.success=true;
   if(Array.isArray(value.data))item.returned_count=value.data.length;
   evidence.push(item);return value;
  }catch(error){item.success=false;item.reason=error instanceof MetaError?error.code:'read_unavailable';evidence.push(item);return null;}
 };
 const debug=(await read('retained_token','debug_token',appToken,{input_token:token}))?.data;
 const tokenEvidence={valid:debug?.is_valid===true,app_matches:String(debug?.app_id)===appId,type:['PAGE','USER','SYSTEM_USER','APP'].includes(debug?.type)?debug.type:'unknown',profile_matches:debug?.profile_id?String(debug.profile_id)===id:null,expiry_in_future:typeof debug?.expires_at==='number'?debug.expires_at===0||debug.expires_at>Date.now()/1000:null,granted_scopes:Array.isArray(debug?.scopes)?debug.scopes.filter((s:string)=>[...META_SCOPES,'ads_read','ads_management'].includes(s)):[]};
 const identity=await read('credential_identity','me',token,{fields:'id'});
 let identityMatches=String(identity?.id)===id;
 if(connection.channel==='facebook') {
  const full=await read('facebook_sync',''+id+'/posts',token,{fields:facebookPostFields,limit:2});
  if(!full) {
   const minimal=await read('facebook_posts_minimal',id+'/posts',token,{fields:'id',limit:2});
   if(minimal)for(const [label,fields] of [['post_content','id,message,created_time,permalink_url'],['shares','id,shares'],['likes','id,likes.limit(0).summary(true)'],['comments','id,comments.limit(0).summary(true)']])await read(label,id+'/posts',token,{fields,limit:2});
  }
 }else await read('instagram_media',id+'/media',token,{fields:'id',limit:2});
 let publishingEvidence:any;
 if(publishingChecks) {
  const required=connection.channel==='facebook'?['pages_manage_posts','pages_read_engagement','pages_show_list']:['instagram_basic','instagram_content_publish','pages_read_engagement'];
  publishingEvidence={eligibility:'unverified',required_scopes:required,missing_scopes:required.filter(s=>!tokenEvidence.granted_scopes.includes(s)),page_id:null,can_post:null,page_tasks:[],page_tasks_verified:false,professional_account_verified:false,quota_usage:null,quota_total:null,blockers:['page_tasks_unverified']};
  // /me resolves the retained PAGE credential, including when bound to linked Instagram.
  // Neither a successful read nor can_post substitutes for the documented Page task requirement.
  const pageId=typeof identity?.id==='string'&&/^\d{1,30}$/.test(identity.id)?identity.id:null;
  if(tokenEvidence.valid&&tokenEvidence.app_matches&&tokenEvidence.type==='PAGE'&&tokenEvidence.expiry_in_future&&pageId&&(connection.channel==='instagram'||identityMatches)) {
   publishingEvidence.page_id=pageId;
   publishingEvidence.scope_target_mismatches=required.filter(scope=>Array.isArray(debug?.granular_scopes)&&debug.granular_scopes.some((g:any)=>g?.scope===scope&&Array.isArray(g.target_ids)&&g.target_ids.length>0)&&!debug.granular_scopes.some((g:any)=>g?.scope===scope&&Array.isArray(g.target_ids)&&g.target_ids.some((target:unknown)=>[pageId,id].includes(String(target)))));
   const page=await read('page_posting_capability',pageId,token,{fields:'id,can_post'});
   if(String(page?.id)===pageId&&typeof page?.can_post==='boolean')publishingEvidence.can_post=page.can_post;
   let owner:any=null, snapshot=oauthEvidence;
   // Legacy accounts evidence is already persisted by service-only OAuth stage/bind.
   // Adopt it only for this exact retained authorizer, generation and business grant.
   const legacy=connection.capabilities?.page_task_source==='accounts'&&connection.capabilities?.page_tasks_verified===true&&connection.meta_user_id===debug?.user_id;
   if(snapshot||legacy)owner=await read('oauth_page_owner',pageId,token,{fields:'id,business{id}'});
   const businessId=String(owner?.id)===pageId&&typeof owner?.business?.id==='string'?owner.business.id:'';
   const hashValue=await hash(token);
   if(!snapshot&&legacy&&/^\d{1,30}$/.test(businessId)&&(debug.granular_scopes||[]).some((g:any)=>g.scope==='business_management'&&g.target_ids?.includes(businessId))) {
    snapshot={subject:debug.user_id,pageId,businessId,generation:connection.credential_generation,tokenHash:hashValue,tasks:connection.capabilities.page_tasks};
   }
   let tasks=snapshot?resolveOAuthTaskEvidence(snapshot,{subject:String(debug?.user_id||''),pageId,businessId,generation:connection.credential_generation,tokenHash:hashValue}):null;
   // Snapshot binding failures fail closed; do not resurrect stale authority via another edge.
   if(!tasks)tasks=await resolvePageRoleTasks(pageId,String(debug?.user_id||''),(path,params)=>read('authorizer_page_roles',path,token,params));
   if(!snapshot&&tasks.state==='unverified'&&tokenEvidence.granted_scopes.includes('pages_manage_metadata')&&assignment&&(!(debug.granular_scopes||[]).some((g:any)=>g.scope==='pages_manage_metadata'&&g.target_ids?.length)||(debug.granular_scopes||[]).some((g:any)=>g.scope==='pages_manage_metadata'&&g.target_ids?.includes(pageId))))tasks=await resolveBusinessPageTasks(pageId,String(debug?.user_id||''),assignment,(path,params)=>read('authorizer_page_assignment',path,token,params));
   // Diagnostic only: the official assigned_users edge is guarded by MANAGE
   // for Page tokens. Discover business context from the exact Page, never UI IDs.
   // Success is not adopted as exact-authorizer task evidence without a mapping.
   if(!snapshot&&tasks.state==='unverified'&&!assignment&&tokenEvidence.granted_scopes.includes('pages_manage_metadata')) {
    const owner=await read('page_business_context',pageId,token,{fields:'id,business{id}'});
    const businessId=owner?.business?.id;
    if(String(owner?.id)===pageId&&typeof businessId==='string'&&/^\d{1,30}$/.test(businessId)) {
     const assigned=await read('page_assignment_visibility',pageId+'/assigned_users',token,{business:businessId,fields:'tasks',limit:1});
     publishingEvidence.assignment_edge_accessible=Array.isArray(assigned?.data);
    }else publishingEvidence.assignment_edge_accessible=null;
   }
   if(snapshot&&tasks.state==='verified'){publishingEvidence.oauth_snapshot_revalidated=true;await onEvidence?.(snapshot);}
   publishingEvidence.page_tasks=tasks.tasks;
   publishingEvidence.page_tasks_verified=tasks.state!=='unverified';
   publishingEvidence.page_task_source=tasks.source;
   publishingEvidence.page_task_state=tasks.state;
   publishingEvidence.page_task_reason=tasks.reason;
   publishingEvidence.blockers=tasks.state==='unverified'?['page_tasks_unverified']:tasks.can_create?[]:['content_task_not_granted'];
   if(connection.channel==='instagram') {
    // Attribute business-assigned access only through the exact token subject's
    // supported business_users relationship and its actual assigned_users row.
    let provenance=assignment?.subject===String(debug?.user_id)&&assignment.businessId===businessId?'business_manager':'unverified';
    if(provenance==='unverified'&&businessId&&tokenEvidence.granted_scopes.includes('business_management')) {
     const mappings=await discoverAuthorizerAssignments(String(debug?.user_id||''),(path,params)=>read('authorizer_business_mapping',path,token,params));
     const mapped=mappings.find(m=>m.businessId===businessId);
     if(mapped) {
      const result=await resolveBusinessPageTasks(pageId,String(debug?.user_id),mapped,(path,params)=>read('authorizer_business_assignment',path,token,params));
      if(result.state==='verified')provenance='business_manager';
     }
    }
    // A current exact active person role can establish direct Page assignment.
    if(!snapshot&&tasks.source==='page_roles'&&tasks.state==='verified')provenance='direct_page';
    publishingEvidence.assignment_provenance=provenance;
    if(provenance==='unverified')publishingEvidence.blockers.push('page_assignment_provenance_unverified');
    if(provenance==='business_manager'&&!tokenEvidence.granted_scopes.some((s:string)=>['ads_read','ads_management'].includes(s)))publishingEvidence.blockers.push('business_manager_ads_read_required');

    const link=await read('linked_instagram_identity',pageId,token,{fields:'id,instagram_business_account{id}'});
    identityMatches=String(link?.id)===pageId&&String(link?.instagram_business_account?.id)===id;
    if(identityMatches) {
     const professional=await read('instagram_account_identity',id,token,{fields:'id'});
     publishingEvidence.professional_account_verified=String(professional?.id)===id;
     const limit=await read('instagram_publishing_limit',id+'/content_publishing_limit',token,{fields:'quota_usage,config'});
     const row=limit?.data?.[0];
     if(Number.isSafeInteger(row?.quota_usage)&&row.quota_usage>=0)publishingEvidence.quota_usage=row.quota_usage;
     if(Number.isSafeInteger(row?.config?.quota_total)&&row.config.quota_total>0)publishingEvidence.quota_total=row.config.quota_total;
    }
   }
  }
  if(!identityMatches)publishingEvidence.blockers.push('credential_account_unverified');
  if(publishingEvidence.missing_scopes.length)publishingEvidence.blockers.push('required_scopes_missing');
  if(publishingEvidence.scope_target_mismatches?.length)publishingEvidence.blockers.push('required_scope_target_unavailable');
  if(!tokenEvidence.valid||!tokenEvidence.app_matches||tokenEvidence.type!=='PAGE'||!tokenEvidence.expiry_in_future)publishingEvidence.blockers.push('page_credential_unverified');
  if(connection.channel==='instagram'&&!publishingEvidence.professional_account_verified)publishingEvidence.blockers.push('professional_account_unverified');
  publishingEvidence.eligibility=publishingEvidence.blockers.length===0?'verified':publishingEvidence.page_task_state==='not_granted'?'not_granted':'unverified';
 }
 return {account_id:id,channel:connection.channel,token:tokenEvidence,credential_identity_matches:identityMatches,page_tasks_verified:connection.capabilities?.page_tasks_verified===true,publishing_enabled:connection.capabilities?.execution_enabled===true&&connection.capabilities?.publishing===true,...(publishingEvidence?{publishing_evidence:publishingEvidence}:{}),evidence};
}

export function verifiedFacebookRead(result:any,connection:any):boolean {
 return connection.channel==='facebook'&&connection.status==='error'&&connection.error_code==='meta_permission_or_token_invalid'&&Date.parse(connection.expires_at)>Date.now()
 &&result.account_id===connection.provider_account_id&&result.token.valid===true&&result.token.app_matches===true&&result.token.type==='PAGE'&&result.token.expiry_in_future===true&&result.credential_identity_matches===true
 &&result.evidence.some((r:any)=>r.check==='facebook_sync'&&r.success===true);
}
