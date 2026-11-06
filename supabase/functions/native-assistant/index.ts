import {newTicket,hashTicket,connectVoice,cleanupVoice} from './voiceConnection.js';
import {callerAccess,readInventory} from './inventory.js';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import {dispatch} from './handler.js';
import {AssistantError} from './provider.js';
const STAGING='https://ujkzdaaadnvcfayuldmh.supabase.co';
const origins=new Set(['https://fnb-system-staging.vercel.app','http://localhost:5173']);
const safeCodes=new Set(['admin_required','settings_view_required','settings_edit_required','configuration_changed','configuration_invalid','connection_test_required','session_unavailable','session_limit','thread_capacity','title_invalid','memory_invalid','request_conflict','request_rate_limit','daily_request_limit','assistant_busy','conversation_limit','daily_token_budget','turn_unavailable','turn_no_longer_active','assistant_disabled','scope_required','voice_disabled','voice_test_required','voice_request_limit','realtime_not_authorized','voice_session_active','voice_session_expired','voice_capacity','voice_daily_limit','voice_approval_required','realtime_call_binding_failed']);
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://fnb-system-staging.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-openai-agents-sdk','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Expose-Headers':'Location',Vary:'Origin'};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(Deno.env.get('SUPABASE_URL')!==STAGING)return json({error:'staging_only'},403);
 if(origin&&!origins.has(origin))return json({error:'origin_denied'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization))return json({error:'authentication_required'},401);
 try{
 const boundedFetch=(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(10000),...(init?.signal?[init.signal]:[])])});
 const caller=createClient(STAGING,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization},fetch:boundedFetch},auth:{persistSession:false,autoRefreshToken:false}});
 const service=createClient(STAGING,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{global:{fetch:boundedFetch},auth:{persistSession:false,autoRefreshToken:false}});
 async function connection(action:string,payload:unknown){const {data:result,error}=await service.rpc('native_assistant_voice_connection',{p_action:action,p_payload:payload});if(error)throw new AssistantError(safeCodes.has(error.message)?error.message:'assistant_request_failed',error.code==='42501'?403:409);return result;}
 const mode=new URL(request.url).searchParams.get('voice');
 if(mode==='cleanup')return json(await cleanupVoice(authorization.slice(7),{connection}));
 if(mode==='webrtc'){
  if(request.headers.get('content-type')?.split(';')[0]!=='application/sdp')return json({error:'invalid_request'},400);
  const result=await connectVoice(request,authorization.slice(7),{connection,registry:async(actor:string,payload:unknown)=>{const {data:entry,error}=await service.rpc('native_assistant_provider_registry',{p_actor:actor,p_action:'key',p_payload:payload});if(error)throw new AssistantError('realtime_not_authorized',403);return entry;}});
  return new Response(result.sdp,{status:201,headers:{...headers,'Content-Type':'application/sdp',Location:'https://api.openai.com/v1/realtime/calls/'+result.call_id}});
 }
 if(mode)return json({error:'invalid_request'},400);
 const {data,error}=await caller.auth.getUser();
 if(error||!data.user)return json({error:'authentication_required'},401);
 const access=await callerAccess(caller);
 async function rpc(action:string,payload:unknown){
  const {data:result,error:failure}=await service.rpc('native_assistant_service',{p_actor:data.user!.id,p_action:action,p_payload:payload});
  if(failure){const code=safeCodes.has(failure.message)?failure.message:'assistant_request_failed';throw new AssistantError(code,failure.code==='42501'?403:failure.code==='40001'?409:failure.code==='54000'?429:failure.code==='55000'?409:400);}return result;
 }
  const reader=request.body?.getReader();if(!reader)return json({error:'invalid_request'},400);
  const chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1550000){await reader.cancel();return json({error:'request_too_large'},413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const raw=new TextDecoder().decode(bytes);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_request'},400);}
  async function reserveRealtime(action:string,args:{session_id:string;request_id:string;provider:string}){
   if(action==='server_bind')return connection('bind',{...args,actor:data.user!.id});
   const {data:result,error:failure}=await service.rpc('native_assistant_voice_lease',{p_actor:data.user!.id,p_action:['sdk_baseline','start'].includes(action)?'admit':action,p_payload:args});
   if(failure){const code=safeCodes.has(failure.message)?failure.message:'assistant_request_failed';throw new AssistantError(code,failure.code==='42501'?403:failure.code==='40001'?409:failure.code==='54000'?429:503);}return result;
  }
  async function registry(action:string,payload:unknown){
   const {data:result,error:failure}=await service.rpc('native_assistant_provider_registry',{p_actor:data.user!.id,p_action:action,p_payload:payload});
   if(failure){const code=safeCodes.has(failure.message)?failure.message:'assistant_request_failed';throw new AssistantError(code,failure.code==='42501'?403:failure.code==='40001'?409:failure.code==='54000'?429:400);}
   return result;
  }
  async function voiceHistory(payload:unknown){
   const {data:result,error:failure}=await service.rpc('native_assistant_voice_history',{p_actor:data.user!.id,p_payload:payload});
   if(failure)throw new AssistantError(safeCodes.has(failure.message)?failure.message:'assistant_request_failed',failure.code==='42501'?403:failure.code==='54000'?429:409);
   return result;
  }
  async function voiceUsage(action:string,payload:unknown){const {data:result,error}=await service.rpc('native_assistant_voice_usage',{p_actor:data.user!.id,p_action:action,p_payload:payload});if(error)throw new AssistantError(safeCodes.has(error.message)?error.message:'assistant_request_failed',error.code==='42501'?403:error.code==='40001'?409:400);return result;}
  async function issueVoiceTicket(args:Record<string,unknown>,config:Record<string,unknown>){const token=newTicket();const {data:lease,error}=await service.rpc('native_assistant_voice_lease',{p_actor:data.user!.id,p_action:'ticket',p_payload:{...args,hash:await hashTicket(token),config:{...config,voice:args.voice}}});if(error)throw new AssistantError('voice_session_active',409);return {client_secret:token,webrtc_url:STAGING+'/functions/v1/native-assistant?voice=webrtc',maximum_seconds:lease.maximum_seconds};}
  return json(await dispatch(body,{issueVoiceTicket,voiceUsage,rpc,reserveRealtime,registry,voiceHistory,get:(name:string)=>Deno.env.get(name),signal:request.signal,access,readTool:(args:unknown,signal:AbortSignal)=>readInventory(caller,args,signal)}));
 }catch(cause){return json({error:cause instanceof AssistantError?cause.code:'assistant_unavailable',...(cause instanceof AssistantError&&cause.diagnostic?{diagnostic:cause.diagnostic}:{})},cause instanceof AssistantError?cause.status:503);}
});
