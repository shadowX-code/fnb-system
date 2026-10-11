import { inboxConnectorContracts } from './metaInboxAdapters.ts';
import { MetaError } from './metaGraph.ts';
// UI vocabulary is derived from independent provider evidence, never an execution grant.
export function capabilityHealth(publishing:any, inbox:any, sync:any) {
 const valid=publishing.token?.valid&&publishing.token?.app_matches&&publishing.token?.type==='PAGE'&&publishing.token?.expiry_in_future&&publishing.credential_identity_matches;
 const scopes=publishing.token?.granted_scopes||[];
 const publish=publishing.publishing_evidence;
 const publishingState=publish?.missing_scopes?.length?'permission_required':publish?.eligibility==='verified'?'verified':'action_required';
 const messagingState=inbox.missing_permissions?.length?'permission_required':!inbox.authorization_verified?'action_required':!inbox.subscriptions_verified?'action_required':inbox.real_inbound_verified?'operational':'connected';
 const insightScope=publishing.channel==='instagram'?'instagram_manage_insights':'read_insights';
 const insightVerified=(sync?.posts||[]).some((p:any)=>Object.keys(p.metrics||{}).some(k=>['reach','views'].includes(k)));
 return {credential_valid:!!valid,publishing:{state:publishingState,reason:publish?.missing_scopes?.length?'permission_missing':publish?.eligibility==='verified'?'ready':publish?.blockers?.[0]||'authorization_unverified'},messaging:{state:messagingState,reason:inbox.missing_permissions?.length?'permission_missing':!inbox.authorization_verified?'authorization_unverified':!inbox.subscriptions_verified?'subscriptions_missing':inbox.real_inbound_verified?'ready':'inbound_pending'},insights:{state:!scopes.includes(insightScope)?'permission_required':insightVerified?'operational':'connected',reason:!scopes.includes(insightScope)?'permission_missing':insightVerified?'ready':'metrics_unavailable'},posts_verified:Array.isArray(sync?.posts),execution_enabled:false};
}
// Preserve all existing fields on this app's Page installation; never replace another app.
export function subscriptionPlan(channel:'facebook'|'instagram',appId:string,inbox:any,response:any) {
 const rows=Array.isArray(response?.data)?response.data.filter((r:any)=>String(r.id)===appId):[];
 if(!Array.isArray(response?.data)||response.paging?.next||rows.length>1)throw new MetaError('subscription_read_unavailable');
 const existing=rows[0]?.subscribed_fields||[];
 if(!Array.isArray(existing)||existing.length>100||existing.some((s:any)=>typeof s!=='string'||!/^[a-z_]{1,80}$/.test(s)))throw new MetaError('subscription_read_unavailable');
 const contract=inboxConnectorContracts[channel];
 const missing=contract.pageSubscriptionFields.filter(f=>!existing.includes(f));
 const callback=inbox.app_webhook?.registered&&inbox.app_webhook?.active&&inbox.app_webhook?.callback_matches&&contract.subscriptionFields.every(f=>inbox.app_webhook.fields?.includes(f));
 return {page_id:inbox.page_id,fields:[...new Set([...existing,...contract.pageSubscriptionFields])].sort(),missing,eligible:inbox.authorization_verified===true&&!!callback,reason:!inbox.authorization_verified?'authorization_unverified':!callback?'app_setup_required':missing.length?'confirmation_required':'already_configured'};
}
export async function installSubscriptions(plan:any,state:string,guard:()=>Promise<void>,checkpoint:(state:string)=>Promise<void>,read:()=>Promise<any>,post:()=>Promise<any>) {
 if(!plan.eligible)throw new MetaError(plan.reason);
 await guard();
 if(!plan.missing.length){await checkpoint('verified');return 'verified';}
 // Once a provider write could have happened, reconciliation is read-only.
 if(['pending','reconciling','verified'].includes(state))return state==='verified'?'verified':'reconciling';
 if(state==='failed')return 'failed';
 await checkpoint('pending');await guard();
 try {const response=await post();if(response?.success!==true&&response?.success!=='true'){await checkpoint('reconciling');return 'reconciling';}}
 catch(error){if(error instanceof MetaError&&!error.uncertain){await checkpoint('failed');return 'failed';}await checkpoint('reconciling');return 'reconciling';}
 await guard();
 try {const current=await read();if(current.missing.length===0){await checkpoint('verified');return 'verified';}}catch{/* A receipt without a confirmed installation remains pending. */}
 await checkpoint('reconciling');return 'reconciling';
}
