import { MetaGraph, MetaError } from './metaGraph.ts';
import { hash, STAGING_SUPABASE } from './metaSecurity.ts';
import { inboxConnectorContracts } from './metaInboxAdapters.ts';

// Independent read-only messaging resolver. Never alters publishing authority.
export async function verifyInboxConnection(graph:MetaGraph, appId:string, appToken:string, connection:any, credential:any, guard:()=>Promise<void>, inbound:any[]=[] ) {
 const evidence:any[]=[];
 const read=async(path:string, token:string, params:any)=>{
  await guard();const item:any={endpoint:path.endsWith('/assigned_pages')?'exact_authorizer/assigned_pages':path.endsWith('/roles')?'page/roles':path,http_status:null,graph_error_code:null,graph_error_subcode:null};
  try {const value=await graph.request(path,token,params,'GET',(status,code,detail)=>Object.assign(item,{http_status:status,graph_error_code:code,graph_error_subcode:detail?.graph_error_subcode??null}));evidence.push(item);return value;}
  catch(error){evidence.push({...item,error:error instanceof MetaError?error.code:'read_unavailable'});return null;}
 };
 const contract=inboxConnectorContracts[connection.channel as 'facebook'|'instagram'];
 if(!contract)throw new Error('unsupported_channel');
 const appSubscriptions=await read(`${appId}/subscriptions`,appToken,{});
 const object=connection.channel==='facebook'?'page':'instagram';
 const appRowsForObject=Array.isArray(appSubscriptions?.data)?appSubscriptions.data.filter((s:any)=>s.object===object):[];
 const appWebhook=appRowsForObject.length===1&&!appSubscriptions?.paging?.next?appRowsForObject[0]:null;
 const appWebhookStatus={object,registered:!!appWebhook,active:appWebhook?.active===true,callback_matches:appWebhook?.callback_url===`${STAGING_SUPABASE}/functions/v1/marketing-inbox/webhook`,fields:Array.isArray(appWebhook?.fields)?appWebhook.fields.map((f:any)=>f.name).filter((s:string)=>contract.subscriptionFields.includes(s)):[]};
 const debug=(await read('debug_token',appToken,{input_token:credential.token}))?.data;
 const scopes=(Array.isArray(debug?.scopes)?debug.scopes:[]).filter((s:string)=>contract.requiredPermissions.includes(s));
 const missing=contract.requiredPermissions.filter(s=>!scopes.includes(s));
 const me=await read('me',credential.token,{fields:'id'});
 const pageId=typeof me?.id==='string'&&/^\d{1,30}$/.test(me.id)?me.id:null;
 let accountVerified=connection.channel==='facebook'&&pageId===connection.provider_account_id;
 if(pageId&&connection.channel==='instagram'){
  const linked=await read(pageId,credential.token,{fields:'id,instagram_business_account{id}'});
  accountVerified=linked?.id===pageId&&linked?.instagram_business_account?.id===connection.provider_account_id;
 }
 const tokenVerified=debug?.is_valid===true&&String(debug.app_id)===appId&&debug.type==='PAGE'&&String(debug.profile_id)===pageId&&String(debug.user_id)===String(connection.meta_user_id)&&[debug.expires_at,debug.data_access_expires_at].every(v=>typeof v==='number'&&(v===0||v>Date.now()/1000));
 const targetsVerified=contract.requiredPermissions.every(scope=>!(debug?.granular_scopes||[]).some((g:any)=>g.scope===scope&&g.target_ids?.length)|| (debug?.granular_scopes||[]).some((g:any)=>g.scope===scope&&g.target_ids?.some((id:string)=>[pageId,connection.provider_account_id].includes(id))));
 let tasks:string[]=[],source='unavailable';
 // Only explicit messaging tasks; MANAGE/CREATE_CONTENT never imply MESSAGE.
 const messagingTasks=(v:any)=>Array.isArray(v)?v.filter((s:unknown)=>['MESSAGE','MESSAGING','PROFILE_PLUS_MESSAGING'].includes(String(s))):[];
 const snapshot=credential.oauthTaskEvidence;
 if(tokenVerified&&accountVerified&&pageId){
  const owner=await read(pageId,credential.token,{fields:'id,business{id}'});
  if(snapshot&&snapshot.subject===debug.user_id&&snapshot.pageId===pageId&&snapshot.businessId===owner?.business?.id&&snapshot.generation===connection.credential_generation&&snapshot.tokenHash===await hash(credential.token)){
   tasks=messagingTasks(snapshot.tasks);if(tasks.length)source='oauth_accounts';
  }
  if(!tasks.length&&connection.capabilities?.page_task_source==='accounts'&&connection.capabilities?.page_tasks_verified===true&&connection.meta_user_id===debug.user_id&&owner?.id===pageId&&/^\d{1,30}$/.test(owner?.business?.id||'')&&(debug.granular_scopes||[]).some((g:any)=>g.scope==='business_management'&&g.target_ids?.includes(owner.business.id))){tasks=messagingTasks(connection.capabilities.page_tasks);if(tasks.length)source='oauth_accounts';}
  if(!tasks.length){
   const roles=await read(`${pageId}/roles`,credential.token,{uid:debug.user_id,fields:'id,is_active,tasks',limit:2});
   if(roles?.data?.length===1&&!roles.paging?.next&&roles.data[0].id===debug.user_id&&roles.data[0].is_active===true){tasks=messagingTasks(roles.data[0].tasks);if(tasks.length)source='exact_authorizer_roles';}
  }
  const assignment=credential.authorizerAssignment;
  if(!tasks.length&&assignment?.subject===debug.user_id&&assignment.businessId===owner?.business?.id&&/^\d{1,30}$/.test(assignment.businessUserId||'')){
   let after:string|undefined;let complete=false;const rows:any[]=[];
   for(let n=0;n<10;n++){
    const value=await read(`${assignment.businessUserId}/assigned_pages`,credential.token,{fields:'id,tasks',limit:50,after});
    if(!Array.isArray(value?.data))break;rows.push(...value.data);
    if(!value.paging?.next){complete=true;break;}
    after=value.paging?.cursors?.after;if(typeof after!=='string'||after.length>2048)break;
   }
   const matches=rows.filter(r=>r.id===pageId);
   if(complete&&matches.length===1){tasks=messagingTasks(matches[0].tasks);if(tasks.length)source='exact_business_authorizer_assignment';}
  }
 }
 const subscribed=pageId?await read(`${pageId}/subscribed_apps`,credential.token,{fields:'id,subscribed_fields',limit:100}):null;
 const appRows=Array.isArray(subscribed?.data)?subscribed.data.filter((r:any)=>String(r.id)===appId):[];
 const fields=appRows.length===1&&!subscribed?.paging?.next&&Array.isArray(appRows[0].subscribed_fields)?appRows[0].subscribed_fields.filter((s:string)=>contract.subscriptionFields.includes(s)):[];
 const missingSubscriptions=contract.subscriptionFields.filter(s=>!fields.includes(s));
 const conversations=tokenVerified&&accountVerified&&!missing.length?await read(`${pageId}/conversations`,credential.token,{fields:'id,participants{id},messages.limit(10){id}',limit:20,...(connection.channel==='instagram'?{platform:'instagram'}:{})}):null;
 const verified=tokenVerified&&accountVerified&&targetsVerified&&!missing.length&&tasks.length>0&&Array.isArray(conversations?.data);
 const matched=inbound.filter(e=>e.account_id===connection.provider_account_id&&e.channel===connection.channel&&(conversations?.data||[]).some((row:any)=>row.participants?.data?.some((p:any)=>p.id===e.peer_id)&&row.messages?.data?.some((m:any)=>m.id===e.event_id))).map(e=>e.event_id);
 return {app_webhook:appWebhookStatus,account_id:connection.provider_account_id,channel:connection.channel,page_id:pageId,token_verified:tokenVerified,account_verified:accountVerified,scope_targets_verified:targetsVerified,required_permissions:contract.requiredPermissions,missing_permissions:missing,page_tasks:tasks,task_source:source,authorization_verified:verified,subscriptions_verified:!missingSubscriptions.length,missing_subscriptions:missingSubscriptions,real_inbound_verified:matched.length>0,verified_inbound_ids:matched,evidence};
}
