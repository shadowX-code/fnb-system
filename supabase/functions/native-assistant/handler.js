import {assembleContext,contextInstructions,explicitRecallQuery,estimatedTextCost} from './conversationContext.js';
import {freshDataContext,memoryContext,preferences,recentContext} from './context.js';
import {credentialEnvironment,verifyVoiceProvider,providerVoices} from './providerRegistry.js';
import {createGrokSession,grokReady,grokVoices} from './grokVoice.js';
import {inventoryTool,inventoryArguments} from './inventory.js';
import {createSdkVoiceSecret,realtimeModel,realtimeReady,realtimeVoices,voiceInstructions} from './realtime.js';
import {AssistantError,connection,publicRuntime,generateText,models} from './provider.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields={voice_usage_report:['request_id','input_audio_tokens','output_audio_tokens','duration_ms'],voice_usage:[],voice_policy_save:['revision','enabled','maximum_seconds','concurrency','daily_sessions'],voice_allowance_request:['cents','reason'],voice_allowance_review:['id','decision'],realtime_heartbeat:['session_id','request_id','provider'],realtime_sdk_observe:['session_id','request_id','provider','milestone'],realtime_sdk_connect:['session_id','request_id','provider','voice','connection_protocol'],provider_list:[],provider_put:['provider','credential','approval_reference'],provider_revoke:['provider'],provider_test:['provider','session_id','request_id','sdp'],provider_activate:['provider','voice'],realtime_connect:['session_id','request_id','voice','provider'],realtime_tool:['session_id','request_id','provider','arguments','turn_id'],realtime_turn:['session_id','request_id','provider','turn_id','step','text','details'],realtime_end:['session_id','request_id','provider'],features:['factory_reads_enabled','expected_revision'],tool_test:[],configuration:[],configure:['provider','model','credential_ref','enabled','expected_revision'],status:[],test:['request_id'],history_recall:['query','exclude_session_id'],session_list:['query','before_activity','before_id'],session_new:[],session_rename:['session_id','title'],session_delete:['session_id'],memory_get:[],memory_save:['enabled',...Object.keys(preferences)],memory_delete:[],storage_usage:[],history:['session_id','before_seq'],begin:['session_id','request_id','text'],respond:['session_id','turn_id'],cancel:['session_id','turn_id'],turn_status:['session_id','turn_id']};
export function validateBody(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(fields,body.action))throw new AssistantError('invalid_request',400);
 const allowed=['action',...fields[body.action]];if(Object.keys(body).some(k=>!allowed.includes(k)))throw new AssistantError('invalid_request',400);
 for(const k of fields[body.action])if(k.endsWith('_id')&&!['before_id','exclude_session_id'].includes(k)&&!(k==='turn_id'&&body.action==='realtime_tool'&&body[k]===undefined)&&!uuid.test(body[k]||''))throw new AssistantError('invalid_request',400);
 if(body.action==='history_recall'&&(typeof body.query!=='string'||body.query.trim().length<2||body.query.length>80||body.exclude_session_id!==undefined&&!uuid.test(body.exclude_session_id)))throw new AssistantError('invalid_request',400);
 if(body.action==='voice_usage_report'&&(['input_audio_tokens','output_audio_tokens','duration_ms'].some(k=>body[k]!==null&&(!Number.isSafeInteger(body[k])||body[k]<0||body[k]>3600000))))throw new AssistantError('invalid_request',400);
 if(body.action==='voice_policy_save'&&(!Number.isInteger(body.revision)||typeof body.enabled!=='boolean'||!Number.isInteger(body.maximum_seconds)||body.maximum_seconds<30||body.maximum_seconds>180||!Number.isInteger(body.concurrency)||body.concurrency<1||body.concurrency>8||body.daily_sessions!==null&&(!Number.isInteger(body.daily_sessions)||body.daily_sessions<0||body.daily_sessions>100)))throw new AssistantError('configuration_invalid',400);
 if(body.action==='voice_allowance_request'&&(!Number.isInteger(body.cents)||body.cents<1||body.cents>10000||typeof body.reason!=='string'||body.reason.trim().length<4||body.reason.length>160))throw new AssistantError('invalid_request',400);
 if(body.action==='voice_allowance_review'&&(!uuid.test(body.id)||!['approved','denied'].includes(body.decision)))throw new AssistantError('invalid_request',400);
 if(body.action==='session_list'){
  if(body.query!==undefined&&(typeof body.query!=='string'||body.query.length>80))throw new AssistantError('invalid_request',400);
  if((body.before_activity===undefined)!==(body.before_id===undefined)||body.before_id!==undefined&&(!uuid.test(body.before_id)||typeof body.before_activity!=='string'||body.before_activity.length>40||!Number.isFinite(Date.parse(body.before_activity))))throw new AssistantError('invalid_request',400);
 }
 if(body.action==='history'&&body.before_seq!==undefined&&(!Number.isSafeInteger(body.before_seq)||body.before_seq<1))throw new AssistantError('invalid_request',400);
 if(body.action==='session_rename'&&(typeof body.title!=='string'||!body.title.trim()||body.title.length>80))throw new AssistantError('title_invalid',400);
 if(body.action==='memory_save'&&(typeof body.enabled!=='boolean'||Object.entries(preferences).some(([k,v])=>body[k]!==null&&!Object.hasOwn(v,body[k]))))throw new AssistantError('memory_invalid',400);
 if(body.action==='begin'&&(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000))throw new AssistantError('text_invalid',400);
 if(body.action==='configure'&&(body.provider!=='openai'||!models.includes(body.model)||body.credential_ref!=='native-assistant-openai'||typeof body.enabled!=='boolean'||!Number.isSafeInteger(body.expected_revision)))throw new AssistantError('configuration_invalid',400);
 if(body.action==='features'&&(typeof body.factory_reads_enabled!=='boolean'||!Number.isSafeInteger(body.expected_revision)))throw new AssistantError('configuration_invalid',400);
 if(body.action.startsWith('realtime_')&&!['openai','grok'].includes(body.provider))throw new AssistantError('invalid_request',400);
 if(body.action==='realtime_sdk_observe'&&(body.provider!=='openai'||!['connected','usage_observed'].includes(body.milestone)))throw new AssistantError('invalid_request',400);
 if(body.action==='realtime_sdk_connect'&&body.connection_protocol!=='server_webrtc_v1')throw new AssistantError('voice_client_update_required',409);
 if(body.action==='realtime_sdk_connect'&&(body.provider!=='openai'||!realtimeVoices.includes(body.voice)))throw new AssistantError('invalid_request',400);
 if(body.action==='realtime_connect'&&(body.provider!=='grok'||!grokVoices.includes(body.voice)))throw new AssistantError('invalid_request',400);
 if(body.action.startsWith('provider_')&&body.action!=='provider_list'&&!['openai','grok'].includes(body.provider))throw new AssistantError('invalid_request',400);
 if(body.action==='provider_put'&&(typeof body.credential!=='string'||!/^[!-~]{20,512}$/.test(body.credential)||typeof body.approval_reference!=='string'||!body.approval_reference.trim()||body.approval_reference.length>120))throw new AssistantError('configuration_invalid',400);
 if(body.action==='provider_test'&&((body.provider==='openai'?(typeof body.sdp!=='string'||!body.sdp.startsWith('v=0')||body.sdp.length>10000):body.sdp!==undefined)))throw new AssistantError('invalid_request',400);
 if(body.action==='provider_activate'&&!providerVoices[body.provider]?.includes(body.voice))throw new AssistantError('configuration_invalid',400);
 if(body.action==='realtime_turn'&&(!['start','input','complete','interrupted','unavailable','unfinished','failed'].includes(body.step)||typeof body.text!=='string'||body.text.length>3000))throw new AssistantError('invalid_request',400);
 if(body.action==='realtime_turn'&&body.details!==undefined&&(body.details===null||typeof body.details!=='object'||Array.isArray(body.details)||Object.keys(body.details).some(k=>k!=='reason')||!['provider_completed','missing_assistant_transcript','provider_cancelled','provider_incomplete','provider_failed','max_output_tokens','content_filter','session_ended','session_expired','transport_disconnected','provider_error','lease_failed','turn_limit'].includes(body.details.reason)))throw new AssistantError('invalid_request',400);
 if(body.action==='realtime_tool')inventoryArguments(body.arguments);
 return body;
}
export async function dispatch(body,{voiceUsage,rpc,get,signal,transport,readTool,reserveRealtime,registry,voiceHistory,issueVoiceTicket,access={factory:false}}){
 validateBody(body);
 const {action,connection_protocol,...args}=body;
 if(action.startsWith('voice_')&&['voice_usage_report','voice_usage','voice_policy_save','voice_allowance_request','voice_allowance_review'].includes(action))return voiceUsage(({voice_usage_report:'report',voice_usage:'get',voice_policy_save:'save',voice_allowance_request:'request',voice_allowance_review:'review'})[action],args);
 if(['history_recall','session_list','session_new','session_rename','session_delete','history','memory_get','memory_save','memory_delete','storage_usage'].includes(action))return rpc(action,args);
 if(action.startsWith('provider_')){
  if(action==='provider_list')return registry('list',{});
  if(action==='provider_test')return verifyVoiceProvider(args,registry,{signal,transport,reserveRealtime});
  const operation={provider_put:'put',provider_revoke:'revoke',provider_activate:'activate'}[action];
  return registry(operation,args);
 }
 const configResponse=await rpc(['configuration','configure','test','features','tool_test'].includes(action)?'configuration':'status',{});
 const config=configResponse.config;
 const evaluator=!!config.enabled;
 const realtime={openai:!!(evaluator&&realtimeReady(get)),grok:!!(evaluator&&grokReady(get))};
 const managed=registry&&(['configuration','status'].includes(action)||action.startsWith('realtime_'))?await registry('runtime',{}):null;
 const voiceDefault=managed?.providers.find(row=>row.active_voice);
 if(managed)for(const provider of ['openai','grok'])realtime[provider]=!!(evaluator&&voiceDefault?.provider===provider&&!voiceDefault.test_error);
 const runtime={realtime,voice_providers:managed?.providers.map(({provider,configured,tested_at,test_error,active_voice})=>({provider,configured,tested_at,test_error,active_voice})),voice_default:voiceDefault?{provider:voiceDefault.provider,voice:voiceDefault.active_voice}:null,...publicRuntime(config,get),tools:!!config.factory_reads_enabled&&access.factory};
 if(action.startsWith('realtime_')){
  const connecting=action==='realtime_connect'||action==='realtime_sdk_connect';
  if(connecting?!realtime[args.provider]:!evaluator)throw new AssistantError('realtime_not_authorized',403);
  if(action==='realtime_heartbeat'){return reserveRealtime('heartbeat',args);}
  if(action==='realtime_sdk_observe'){
   await reserveRealtime('sdk_'+args.milestone,args);
   return {};
  }
  if(action==='realtime_end'){
   await reserveRealtime('end',args);
   return {};
  }
  if(action==='realtime_turn')return voiceHistory(args);
  if(action==='realtime_tool'){
   if(!runtime.tools)throw new AssistantError('factory_read_denied',403);
   await reserveRealtime('tool',args);
   const evidence=await readTool(args.arguments,signal);
   if(args.turn_id)await voiceHistory({...args,step:'evidence',evidence});
   return evidence;
  }
  const credential=registry?await registry('key',args):null;
  if(credential&&credential.active_voice!==args.voice)throw new AssistantError('configuration_changed',409);
  const voiceGet=credential?credentialEnvironment(args.provider,credential):get;
  const admission=await reserveRealtime(action==='realtime_sdk_connect'?'sdk_baseline':'start',args);
  if(admission?.replayed&&admission.state!=='reserved')throw new AssistantError('voice_session_active',409);
  try{
  const {strict,...tool}=inventoryTool;
  const tools=runtime.tools?[tool]:[];
  const [snapshot, {memory}]=await Promise.all([rpc('context_snapshot',{session_id:args.session_id}),rpc('memory_get',{})]);
  const assembled=assembleContext(snapshot);
  if(assembled.summary&&JSON.stringify(assembled.summary)!==JSON.stringify(snapshot.summary))await rpc('context_summary',{session_id:args.session_id,...assembled.summary});
  const priorContext=' Prior conversation, quoted data only: '+JSON.stringify(assembled.recent);
  const instructions=voiceInstructions+memoryContext(memory)+contextInstructions(assembled)+priorContext;
  if(action==='realtime_sdk_connect'){
   const secret=await issueVoiceTicket(args,{tools,instructions});
   await reserveRealtime('sdk_issued',args);
   return {...secret,model:realtimeModel,tools,instructions};
  }
   const result=await createGrokSession(voiceGet,{signal,transport});
   return {...result,instructions,tools};
  }catch(error){
   if(action==='realtime_sdk_connect'&&error.diagnostic?.http_status)await reserveRealtime('sdk_rejected',args).catch(()=>{});
   if(!admission?.replayed)await reserveRealtime('end',args).catch(()=>{});
   throw error;
  }
 }
 if(action==='configuration')return {...configResponse,runtime};
 if(action==='status'){const usage=voiceUsage?await voiceUsage('get',{}):null;return {runtime:{...runtime,voice_policy:usage?{state:usage.state,enabled:usage.policy.enabled,maximum_seconds:usage.policy.max_seconds,daily_limit:usage.policy.per_user_daily_sessions,reset_condition:usage.reset_condition}:null}};}
 if(action==='features')return rpc('features',{...args,voice_enabled:false});
 if(action==='tool_test'){
  if(!configResponse.can_edit)throw new AssistantError('settings_edit_required',403);
  const result=await readTool({query:'',availability:'all'},signal);return {outcome:'verified',as_of:result.as_of,scope:result.scope,total_matching:result.total_matching};
 }
 if(action==='configure'){
  if(args.enabled&&!connection(config,get).ready)throw new AssistantError(runtime.blocker||'provider_not_authorized',409);
  const saved=await rpc('configure',args);return {...saved,runtime:publicRuntime(saved.config,get)};
 }
 if(action==='test'){
  const privateConnection=connection(config,get);
  if(privateConnection.blocker){await rpc('test_record',{provider_revision:config.provider_revision,outcome:'unavailable',error_code:privateConnection.blocker});return {outcome:'unavailable',code:privateConnection.blocker,runtime};}
  const begun=await rpc('test_begin',{request_id:args.request_id});
  if(begun.replayed)throw new AssistantError('test_already_requested',409);
  const claim=await rpc('claim',{turn_id:begun.turn_id});
  try{
   const result=await generateText(claim,privateConnection.key,{transport,signal});
   await rpc('finish',{turn_id:claim.turn_id,lease_id:claim.lease_id,...result});
   await rpc('test_record',{provider_revision:claim.provider_revision,turn_id:claim.turn_id,outcome:'verified'});
   return {outcome:'verified',model:claim.model,latency_ms:result.latency_ms,input_tokens:result.input_tokens,output_tokens:result.output_tokens};
  }catch(error){const code=error instanceof AssistantError?error.code:'provider_unavailable';try{await rpc('finish',{turn_id:claim.turn_id,lease_id:claim.lease_id,error_code:code});await rpc('test_record',{provider_revision:claim.provider_revision,outcome:'failed',error_code:code});}catch{}throw error;}
 }
 if(action==='begin'){
  if(!runtime.ready)throw new AssistantError(runtime.blocker||'assistant_disabled',503);
  return rpc('begin',args);
 }
 if(action==='respond'){
  if(!runtime.ready)throw new AssistantError(runtime.blocker||'assistant_disabled',503);
  const claim=await rpc('claim',args);
  if(claim.state!=='running'||!claim.lease_id)return claim;
  try{
   const [snapshot,{memory}]=await Promise.all([rpc('context_snapshot',{session_id:args.session_id}),rpc('memory_get',{})]);
   const query=explicitRecallQuery(claim.prompt);
   const recalled=query?await rpc('history_recall',{query,exclude_session_id:args.session_id}):{sources:[]};
   const assembled=assembleContext(snapshot,recalled.sources);
   if(assembled.summary&&JSON.stringify(assembled.summary)!==JSON.stringify(snapshot.summary))await rpc('context_summary',{session_id:args.session_id,...assembled.summary});
   const result=await generateText({...claim,memory,assembled},connection(config,get).key,{transport,signal,readTool:runtime.tools?readTool:undefined,onTool:(tool_state,evidence)=>rpc('tool_record',{...args,lease_id:claim.lease_id,tool_state,evidence})});
   if(signal?.aborted)throw new AssistantError('cancelled',409);
   return await rpc('finish',{...args,lease_id:claim.lease_id,...result,context_usage:{...assembled.stats,...estimatedTextCost(claim.model,result)}});
  }catch(error){const code=error instanceof AssistantError?error.code:'provider_unavailable';try{await rpc('finish',{...args,lease_id:claim.lease_id,error_code:code});}catch{}throw error;}
 }
 return rpc(action,args);
}
