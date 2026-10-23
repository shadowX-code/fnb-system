import {productionPublishingPolicy} from './marketingExecution.mjs';
import { MetaGraph, MetaError } from './metaGraph.ts';
import { connectionBinding, unseal, seal } from './metaSecurity.ts';
import { diagnoseMetaConnection } from './metaConnectionDiagnostics.ts';
import { verifyInboxConnection } from './metaInboxVerification.ts';
import { capabilityHealth, subscriptionPlan, installSubscriptions } from './metaOnboarding.ts';
import { readRecentInbox } from './metaInboxRecovery.ts';

async function call(db:any,name:string,args:any={},signal?:AbortSignal) {
 signal?.throwIfAborted();
 const request=db.rpc(name,args);
 const {data,error}=await (signal&&request.abortSignal?request.abortSignal(signal):request);
 signal?.throwIfAborted();
 if(error)throw new MetaError('connection_health_authority_changed');
 return data;
}
// One leased account per tick. Reuses canonical authorizer, scope and generation guards.
export async function runConnectionHealth(db:any,graph:MetaGraph,config:any,keys:string[],connectionId:string|null=null) {
 const signal=AbortSignal.timeout(45000);
 const boundedCall=(name:string,args:any={})=>call(db,name,args,signal);
 graph=graph.withSignal(signal);
 const job=await boundedCall('marketing_meta_health_claim',{p_connection:connectionId});
 if(!job)return null;
 const args={p_connection:job.connection_id,p_generation:job.generation,p_lease:job.lease};
 const guard=async()=>{signal.throwIfAborted();if(!await boundedCall('marketing_meta_health_guard',args))throw new MetaError('connection_health_authority_changed');};
 try {
  await guard();
  const material=await boundedCall('marketing_meta_diagnostic_material',{p_connection:job.connection_id,p_auth_user:job.auth_user_id});
  const credential=await unseal(material.sealed_token,keys,connectionBinding(material));
  const actor={p_connection:material.id,p_generation:material.credential_generation,p_auth_user:job.auth_user_id};
  let snapshot:any;
  const publishing=await diagnoseMetaConnection(graph,config.appId,`${config.appId}|${config.appSecret}`,material,credential.token,guard,true,credential.authorizerAssignment,credential.oauthTaskEvidence,async value=>{snapshot=value;});
  const inbound=await boundedCall('marketing_inbox_verification_events',{p_connection:material.id,p_auth_user:job.auth_user_id});
  let installation:any,recent:any;
  const inboxOptions={recentWindow:true,onConversations:(value:any)=>{recent=value;}};
  let inbox=await verifyInboxConnection(graph,config.appId,`${config.appId}|${config.appSecret}`,material,credential,guard,inbound,value=>{installation=value;},inboxOptions);
  let repair='not_needed';
  let plan:any={eligible:false,missing:[],reason:'subscription_read_unavailable'};
  try{plan=subscriptionPlan(material.channel,config.appId,inbox,installation);}catch{/* A denied installation read must still record revoked messaging authority. */}
  if(plan.eligible&&plan.missing.length) {
   await guard();
   const fixed={page_id:plan.page_id,fields:plan.fields};
   const request=await boundedCall('marketing_meta_health_subscription_request',{...args,p_plan:fixed});
   const intent={...actor,p_request:request,p_plan:fixed};
   const state=await boundedCall('marketing_meta_subscription_intent',intent);
   repair=await installSubscriptions(plan,state,guard,async state=>{await boundedCall('marketing_meta_subscription_intent',{...intent,p_state:state});},async()=>subscriptionPlan(material.channel,config.appId,inbox,await graph.request(`${plan.page_id}/subscribed_apps`,credential.token,{fields:'id,subscribed_fields',limit:100})),()=>graph.request(`${plan.page_id}/subscribed_apps`,credential.token,{subscribed_fields:plan.fields},'POST'));
   if(repair==='verified')inbox=await verifyInboxConnection(graph,config.appId,`${config.appId}|${config.appSecret}`,material,credential,guard,inbound,value=>{installation=value;},inboxOptions);
  }
  await guard();
  const messaging=await boundedCall('marketing_inbox_record_verification',{...actor,p_evidence:inbox});
  const health=capabilityHealth(publishing,inbox,null);
  Object.assign(health,{echo_subscription_status:inbox.echo_subscription_status});
  if(repair==='failed')health.messaging={state:'needs_attention',reason:'subscription_install_rejected'};
  if(!inbox.subscriptions_verified&&inbox.authorization_verified&&plan.reason==='app_setup_required')health.messaging={state:'needs_attention',reason:'app_setup_required'};
  if(messaging.receiving_verified&&messaging.configuration_verified)health.messaging={state:messaging.delivery_verified?'delivery_verified':'awaiting_first_delivery',reason:messaging.delivery_verified?'ready':'inbound_pending'};
  health.insights=material.last_synced_at&&material.capabilities?.insights&&health.insights.state!=='permission_required'?{state:'connected',reason:'metrics_from_sync'}:health.insights;
  await guard();
  if(snapshot||productionPublishingPolicy(material,false)!==null)await boundedCall('marketing_meta_record_eligibility',{...actor,p_sealed:snapshot?await seal({...credential,oauthTaskEvidence:snapshot},keys[0],connectionBinding(material)):null,p_verified:health.publishing.state==='verified'});
  if(material.channel==='instagram')await boundedCall('marketing_meta_record_formats',{...actor,p_business:health.publishing.state==='verified'&&publishing.publishing_evidence?.story_business_verified===true});
  // Reconciliation is a bounded fallback; provider reads never prove webhook delivery.
  let recovery:any={state:'unavailable',reason:'configuration_unverified',complete:false};
  if(messaging.receiving_verified&&messaging.configuration_verified) {
   recovery=await readRecentInbox(graph,material,credential.token,inbox.page_id,guard,Date.now(),recent);
   if(recovery.events.length)await boundedCall('marketing_inbox_reconcile',{...args,p_events:recovery.events});
   const {events,...summary}=recovery;recovery=summary;
  }
  const retry=inbox.evidence.some((e:any)=>e.http_status===null||e.http_status===429||e.http_status>=500)||recovery.reason==='meta_response_uncertain';
  await guard();
  const execution=productionPublishingPolicy(material,health.publishing.state==='verified');
  if(execution!==null){await guard();await boundedCall('marketing_meta_execution_policy',{p_connection:material.id,p_generation:material.credential_generation,p_enabled:execution});health.execution_enabled=execution;}
  await boundedCall('marketing_meta_record_health',{...actor,p_health:{...health,subscription_repair:repair,recovery}});
  await call(db,'marketing_meta_health_finish',{...args,p_error:retry?'meta_temporarily_unavailable':repair==='reconciling'?'subscription_reconciling':null},AbortSignal.timeout(10000));
  return health;
 }catch(error) {
  await call(db,'marketing_meta_health_finish',{...args,p_error:signal.aborted?'connection_check_deadline':error instanceof MetaError?error.code:'connection_check_unavailable'},AbortSignal.timeout(10000));
  return {messaging:{state:'needs_attention',reason:'connection_check_unavailable'}};
 }
}
