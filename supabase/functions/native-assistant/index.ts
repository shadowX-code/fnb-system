import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import {dispatch} from './handler.js';
import {AssistantError} from './provider.js';
const STAGING='https://ujkzdaaadnvcfayuldmh.supabase.co';
const origins=new Set(['https://fnb-system-staging.vercel.app','http://localhost:5173']);
const safeCodes=new Set(['admin_required','settings_view_required','settings_edit_required','configuration_changed','configuration_invalid','connection_test_required','session_unavailable','session_limit','request_conflict','request_rate_limit','daily_request_limit','assistant_busy','conversation_limit','daily_token_budget','turn_unavailable','turn_no_longer_active','assistant_disabled']);
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://fnb-system-staging.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if(Deno.env.get('SUPABASE_URL')!==STAGING)return json({error:'staging_only'},403);
 if(origin&&!origins.has(origin))return json({error:'origin_denied'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization))return json({error:'authentication_required'},401);
 try{
 const boundedFetch=(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)});
 const caller=createClient(STAGING,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization},fetch:boundedFetch},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await caller.auth.getUser();
 if(error||!data.user)return json({error:'authentication_required'},401);
 const service=createClient(STAGING,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{global:{fetch:boundedFetch},auth:{persistSession:false,autoRefreshToken:false}});
 async function rpc(action:string,payload:unknown){
  const {data:result,error:failure}=await service.rpc('native_assistant_service',{p_actor:data.user!.id,p_action:action,p_payload:payload});
  if(failure){const code=safeCodes.has(failure.message)?failure.message:'assistant_request_failed';throw new AssistantError(code,failure.code==='42501'?403:failure.code==='40001'?409:failure.code==='54000'?429:400);}return result;
 }
  const raw=await request.text();if(new TextEncoder().encode(raw).length>16000)return json({error:'request_too_large'},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_request'},400);}
  return json(await dispatch(body,{rpc,get:(name:string)=>Deno.env.get(name),signal:request.signal}));
 }catch(cause){return json({error:cause instanceof AssistantError?cause.code:'assistant_unavailable'},cause instanceof AssistantError?cause.status:503);}
});
