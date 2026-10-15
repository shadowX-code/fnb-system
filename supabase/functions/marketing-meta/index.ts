import {readCreatorProfile} from '../_shared/metaCreatorProfile.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { META_BASE, META_REDIRECT, META_SCOPES, STAGING_ORIGIN, STAGING_SUPABASE, authorizationUrl, connectionBinding, hash, nonce, seal, unseal, verifySignedRequest } from '../_shared/metaSecurity.ts';
import { diagnoseMetaConnection, verifiedFacebookRead } from '../_shared/metaConnectionDiagnostics.ts';
import { verifyInboxConnection } from '../_shared/metaInboxVerification.ts';
import { runConnectionHealth } from '../_shared/metaConnectionHealth.ts';
import { readMetaPosts } from '../_shared/metaSynchronization.ts';
import { capabilityHealth, subscriptionPlan, installSubscriptions } from '../_shared/metaOnboarding.ts';
import { discoverAds } from '../_shared/metaAds.ts';
import { MetaGraph, MetaError } from '../_shared/metaGraph.ts';
import { commitJournal } from '../_shared/privacyBlob.ts';
const names=['MARKETING_META_APP_ID','MARKETING_META_APP_SECRET','MARKETING_META_LOGIN_CONFIG_ID','MARKETING_META_GRAPH_VERSION','MARKETING_META_TOKEN_ENCRYPTION_KEY'];
const env=(name:string)=>Deno.env.get(name)||'';
const origins=new Set([STAGING_ORIGIN,'http://localhost:5173']);
function headers(req:Request) {return {'Access-Control-Allow-Origin':origins.has(req.headers.get('origin')||'')?req.headers.get('origin')!:STAGING_ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',Vary:'Origin'};}
function json(req:Request,value:unknown,status=200) {return new Response(JSON.stringify(value),{status,headers:{...headers(req),'Content-Type':'application/json'}});}
async function call(db:any,name:string,args:any={}) {const {data,error}=await db.rpc(name,args);if(error)throw new Error(error.code==='42501'?'scope_denied':'marketing_request_rejected');return data;}
Deno.serve(async(req)=>{
 if(env('SUPABASE_URL')!==STAGING_SUPABASE)return json(req,{error:'Staging integration only.'},403);
 const path=new URL(req.url).pathname.split('/marketing-meta')[1]||'/';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 const missing=names.filter(n=>!env(n));
 if(path==='/configuration'&&req.method==='GET')return json(req,{configured:!missing.length,missing,redirect_uri:META_REDIRECT,app_domains:[new URL(STAGING_ORIGIN).hostname,new URL(STAGING_SUPABASE).hostname],deauthorization_uri:`${META_BASE}/deauthorize`,data_deletion_uri:`${META_BASE}/data-deletion`,permissions:META_SCOPES,test_execution_configured:Boolean(env('MARKETING_META_TEST_ACCOUNT_IDS')),production_execution_enabled:false});
 if(req.headers.get('origin')&&!origins.has(req.headers.get('origin')!))return json(req,{error:'Origin unavailable.'},403);
 const service=createClient(STAGING_SUPABASE,env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 try {
  if(path.startsWith('/deletion-status/')&&req.method==='GET') {
   const code=path.slice('/deletion-status/'.length);if(!/^[A-Za-z0-9_-]{43}$/.test(code))return json(req,{error:'Status unavailable.'},404);
   const data=await call(service,'marketing_meta_deletion_status',{p_hash:await hash(code)});return json(req,data||{error:'Status unavailable.'},data?200:404);
  }

  const config={appId:env(names[0]),appSecret:env(names[1]),configId:env(names[2]),version:env(names[3])};
  const key=env(names[4]);
  if(['deauthorize','data-deletion'].some(x=>path===`/${x}`)&&req.method==='POST') {
   if(!config.appSecret)return json(req,{error:'Meta signature configuration is unavailable.'},503);
   const raw=await req.text();if(raw.length>18000)return json(req,{error:'Invalid removal request.'},400);
   const signed=new URLSearchParams(raw).get('signed_request')||'';
   let subject;try{subject=await verifySignedRequest(signed,config.appSecret);}catch{return json(req,{error:'Invalid Meta signature.'},400);}
   const confirmation=nonce(),deletion=path==='/data-deletion';
   const requestHash=await hash(signed),receipt=await hash(confirmation),issued=new Date(subject.issued_at*1000).toISOString();
   // Persist authenticated recovery evidence outside database backups before any local erasure.
   const intent=await call(service,'marketing_privacy_prepare_meta',{p_request:requestHash,p_user:subject.user_id,p_receipt:receipt,p_issued:issued});
   try{await commitJournal(service,intent);}catch{return json(req,{error:'Deletion recovery journal is unavailable. Retry this request.'},503);}
   await call(service,'marketing_meta_removal_once',{p_request_hash:requestHash,p_user_id:subject.user_id,p_deletion:deletion,p_confirmation_hash:receipt,p_issued_at:issued});
   return json(req,deletion?{url:`${META_BASE}/deletion-status/${confirmation}`,confirmation_code:confirmation}:{success:true});
  }
  let caller:any=null,user:any=null;
  if(req.method==='POST'&&['/authorize','/bind','/diagnose','/retry-sync','/health','/subscription-plan','/subscriptions','/creator-profile'].includes(path)) {
   const bearer=req.headers.get('authorization')||'';if(!bearer.startsWith('Bearer '))return json(req,{error:'Sign in to Marketing.'},401);
   caller=createClient(STAGING_SUPABASE,env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
   const identity=await caller.auth.getUser();user=identity.data.user;if(identity.error||!user)return json(req,{error:'Sign in to Marketing.'},401);
  }
  if(missing.length)return json(req,{error:'Meta server configuration is incomplete.',missing},503);
  const graph=new MetaGraph(config,fetch,path==='/callback'?event=>console.info(JSON.stringify({tag:'marketing_meta_discovery_v1',...event})):undefined);
  if(path==='/callback'&&req.method==='GET') {
   const query=new URL(req.url).searchParams;const state=query.get('state')||'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(state))return json(req,{error:'Invalid authorization state.'},400);
   const session=await call(service,'marketing_meta_consume',{p_state_hash:await hash(state)});
   let result='cancelled',reason='';
   if(!query.has('error')) {
    try {
     const discovery=session.purpose==='ads'?await discoverAds(graph,query.get('code')||''):await graph.exchange(query.get('code')||'');
     await call(service,session.purpose==='ads'?'marketing_ads_stage':'marketing_meta_stage',{p_session:session.id,p_user_id:discovery.userId,p_sealed:await seal(discovery,key,`oauth:${session.id}`),p_accounts:discovery.accounts});result='select_account';
    }catch(error){result='authorization_failed';if(session.purpose==='ads'&&error instanceof MetaError&&['ads_read_not_granted','meta_permission_or_token_invalid','ads_pagination_limit','user_token_required'].includes(error.code))reason=error.code;}
   }
   const redirect=new URL(`${STAGING_ORIGIN}/marketing/${session.purpose==='ads'?'ads':'settings'}`);redirect.searchParams.set('meta_result',result);redirect.searchParams.set('marketing_org',session.organization_id);redirect.searchParams.set('marketing_brand',session.brand_id);
   if(reason)redirect.searchParams.set('meta_reason',reason);
   return new Response(null,{status:303,headers:{...headers(req),Location:redirect.toString()}});
  }
  if(req.method!=='POST'||!['/authorize','/bind','/diagnose','/retry-sync','/health','/subscription-plan','/subscriptions','/creator-profile'].includes(path))return json(req,{error:'Endpoint unavailable.'},404);
  const raw=await req.text();if(raw.length>10000)return json(req,{error:'Request too large.'},413);const body=JSON.parse(raw);
  if(path==='/creator-profile'){const result=await readCreatorProfile(caller,service,user.id,graph,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],body);console.info(JSON.stringify({tag:'marketing_creator_official_profile',applicable:result.applicable,reason:result.reason||null,http_status:result.http_status??null,graph_error_code:result.graph_error_code??null,method:result.method||null}));return json(req,result);}
  async function checkConnection(connectionId:string,recordEligibility=false){
   const material=await call(service,'marketing_meta_diagnostic_material',{p_connection:connectionId,p_auth_user:user.id});
   const credential=await unseal(material.sealed_token,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
   const guard=async()=>{const current=await call(service,'marketing_meta_diagnostic_material',{p_connection:material.id,p_auth_user:user.id});if(current.credential_generation!==material.credential_generation||current.provider_account_id!==material.provider_account_id)throw new MetaError('connection_changed');};
   let snapshot:any;
   const publishing=await diagnoseMetaConnection(graph,config.appId,`${config.appId}|${config.appSecret}`,material,credential.token,guard,true,credential.authorizerAssignment,credential.oauthTaskEvidence,async value=>{snapshot=value;});
   const inbound=await call(service,'marketing_inbox_verification_events',{p_connection:material.id,p_auth_user:user.id});
   const inbox=await verifyInboxConnection(graph,config.appId,`${config.appId}|${config.appSecret}`,material,credential,guard,inbound);
   await guard();
   const messaging=await call(service,'marketing_inbox_record_verification',{p_connection:material.id,p_auth_user:user.id,p_generation:material.credential_generation,p_evidence:inbox});
   let sync:any=null;try{if(publishing.token.valid&&publishing.credential_identity_matches)sync=await readMetaPosts(graph,material,credential.token,guard);}catch{/* Independent metrics denial never invalidates publishing or messaging. */}
   const health=capabilityHealth(publishing,inbox,sync);
   if(messaging.configuration_verified){health.messaging={state:messaging.delivery_verified?'delivery_verified':'awaiting_first_delivery',reason:messaging.delivery_verified?'ready':'inbound_pending'};}
   let plan:any={eligible:false,missing:[],reason:'subscription_read_unavailable'};
   try{if(inbox.page_id){await guard();const installed=await graph.request(`${inbox.page_id}/subscribed_apps`,credential.token,{fields:'id,subscribed_fields',limit:100});plan=subscriptionPlan(material.channel,config.appId,inbox,installed);}}catch{/* Installation is unavailable unless a complete response was verified. */}
   await guard();
   if(recordEligibility){const sealed=snapshot?await seal({...credential,oauthTaskEvidence:snapshot},key,connectionBinding(material)):null;await call(service,'marketing_meta_record_eligibility',{p_connection:material.id,p_auth_user:user.id,p_generation:material.credential_generation,p_sealed:sealed,p_verified:health.publishing.state==='verified'});}
   await call(service,'marketing_meta_record_health',{p_connection:material.id,p_auth_user:user.id,p_generation:material.credential_generation,p_health:health});
   return {material,credential,guard,inbox,health,plan};
  }
  async function subscribe(checked:any,requestId:string){
   const {material,credential,guard,inbox,plan}=checked;
   if(!plan.eligible)throw new MetaError(plan.reason);
   const fixed={page_id:plan.page_id,fields:plan.fields};
   const args={p_request:requestId,p_connection:material.id,p_auth_user:user.id,p_generation:material.credential_generation,p_plan:fixed};
   const state=await call(service,'marketing_meta_subscription_intent',args);
   const checkpoint=async(state:string)=>{await call(service,'marketing_meta_subscription_intent',{...args,p_state:state});};
   return installSubscriptions(plan,state,guard,checkpoint,async()=>subscriptionPlan(material.channel,config.appId,inbox,await graph.request(`${plan.page_id}/subscribed_apps`,credential.token,{fields:'id,subscribed_fields',limit:100})),()=>graph.request(`${plan.page_id}/subscribed_apps`,credential.token,{subscribed_fields:plan.fields},'POST'));
  }
  if(['/health','/subscription-plan','/subscriptions'].includes(path)){
   const checked=await checkConnection(body.connectionId);
   if(path==='/subscriptions'){
    if(body.approveSubscriptions!==true||!body.requestId||JSON.stringify(body.expectedPlan)!==JSON.stringify({page_id:checked.plan.page_id,fields:checked.plan.fields}))return json(req,{error:'Review and confirm the current Inbox update installation.'},409);
    const outcome=await subscribe(checked,body.requestId);return json(req,{state:outcome,execution_enabled:false});
   }
   if(path==='/health')await call(service,'marketing_meta_request_health',{p_connection:checked.material.id,p_auth_user:user.id});
   return json(req,{health:checked.health,plan:checked.plan,echo_subscriptions_verified:checked.inbox.echo_subscriptions_verified,execution_enabled:false});
  }
  if(path==='/diagnose'||path==='/retry-sync') {
   const material=await call(service,'marketing_meta_diagnostic_material',{p_connection:body.connectionId,p_auth_user:user.id});
   const credential=await unseal(material.sealed_token,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connectionBinding(material));
   const guard=async()=>{const current=await call(service,'marketing_meta_diagnostic_material',{p_connection:body.connectionId,p_auth_user:user.id});if(current.credential_generation!==material.credential_generation)throw new Error('connection_changed');};
   let evidence:any;
   const result=await diagnoseMetaConnection(graph,config.appId,`${config.appId}|${config.appSecret}`,material,credential.token,guard,path==='/diagnose',credential.authorizerAssignment,credential.oauthTaskEvidence,async value=>{evidence=value;});
   if(path==='/retry-sync') {
    if(!verifiedFacebookRead(result,material))return json(req,{error:'Facebook read access could not be verified. Check connection details.'},409);
    await call(service,'marketing_meta_retry_sync_verified',{p_connection:material.id,p_auth_user:user.id,p_generation:material.credential_generation});
   }
   if(path==='/diagnose'&&body.readOnly!==true) {
    const sealed=evidence?await seal({...credential,oauthTaskEvidence:evidence},key,connectionBinding(material)):null;
    await call(service,'marketing_meta_record_eligibility',{p_connection:material.id,p_auth_user:user.id,p_generation:material.credential_generation,p_sealed:sealed,p_verified:result.publishing_evidence?.eligibility==='verified'});
   }
   return json(req,result);
  }
  if(path==='/authorize') {
   const state=nonce();const started=await call(caller,'marketing_meta_begin',{p_org:body.organizationId,p_brand:body.brandId,p_state_hash:await hash(state),p_redirect_uri:META_REDIRECT});
   if(body.connectionId)await call(service,'marketing_meta_reconnect_intent',{p_session:started.id,p_auth_user:user.id,p_connection:body.connectionId});
   return json(req,{authorization_url:authorizationUrl(config,state)});
  }
  const session=await call(service,'marketing_meta_session_material',{p_session:body.sessionId,p_auth_user:user.id});
  if(body.confirmOwnership!==true||body.brandId!==session.brand_id||!Array.isArray(body.assets)||body.assets.length<1||body.assets.length>2)return json(req,{error:'Select exact accounts and confirm their FeedX brand.'},400);
  const discovery=await unseal(session.sealed_discovery,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],`oauth:${session.id}`);
  const assets=[];
  for(const chosen of body.assets){
   const account=discovery.accounts.find((a:any)=>a.id===chosen.id&&a.channel===chosen.channel);
   const token=account&&discovery.tokens[`${account.channel}:${account.id}`];
   if(!token||Date.parse(discovery.expiresAt)<=Date.now())return json(req,{error:'Account selection expired. Connect again to refresh the available accounts.'},409);
   const verified=await graph.request(account.id,token,{fields:account.channel==='facebook'?'id,name':'id,username'});
   if(String(verified.id)!==account.id)return json(req,{error:'Meta could not verify the selected account. Reload account selection.'},409);
   if(account.channel==='instagram'){
    const link=await graph.request(account.page_id,token,{fields:'id,instagram_business_account{id}'});
    if(link.id!==account.page_id||link.instagram_business_account?.id!==account.id)return json(req,{error:'The linked Instagram account changed. Connect again to select the current assets.'},409);
   }
   const sealed=await seal({token,authorizerAssignment:discovery.authorizerAssignments?.[`${account.channel}:${account.id}`]},key,connectionBinding({brand_id:session.brand_id,channel:account.channel,provider_account_id:account.id}));
   assets.push({id:account.id,channel:account.channel,expectedConnectionId:chosen.expectedConnectionId??null,expectedGeneration:chosen.expectedGeneration??null,sealed_token:sealed});
  }
  const connections=await call(service,'marketing_meta_bind_selection',{p_session:session.id,p_auth_user:user.id,p_brand:body.brandId,p_assets:assets,p_expiry:discovery.expiresAt,p_confirm:true});
  const outcomes=[];
  for(const connection of connections){
   const health=await runConnectionHealth(service,graph,config,[key,env('MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY')],connection.id);
   outcomes.push({id:connection.id,health});
  }
  return json(req,{connections,outcomes,execution_enabled:false});
 }catch(error) {return json(req,{error:error instanceof MetaError&&error.graphCode===190?'Meta authorization expired or was revoked. Reconnect this account.':error instanceof MetaError&&[10,200].includes(error.graphCode||0)?'Meta has not authorized this operation. Review account access or contact your FeedX administrator about App Review.':'The connection could not be updated. Reload account selection, check brand ownership and resolve any pending delivery before trying again.'},409);}
});
