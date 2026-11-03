import {AssistantError,connection,publicRuntime,generateText,models} from './provider.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields={configuration:[],configure:['provider','model','credential_ref','enabled','expected_revision'],status:[],test:['request_id'],session_list:[],session_new:[],history:['session_id'],begin:['session_id','request_id','text'],respond:['session_id','turn_id'],cancel:['session_id','turn_id'],turn_status:['session_id','turn_id']};
export function validateBody(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(fields,body.action))throw new AssistantError('invalid_request',400);
 const allowed=['action',...fields[body.action]];if(Object.keys(body).some(k=>!allowed.includes(k)))throw new AssistantError('invalid_request',400);
 for(const k of fields[body.action])if(k.endsWith('_id')&&!uuid.test(body[k]||''))throw new AssistantError('invalid_request',400);
 if(body.action==='begin'&&(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000))throw new AssistantError('text_invalid',400);
 if(body.action==='configure'&&(body.provider!=='openai'||!models.includes(body.model)||body.credential_ref!=='native-assistant-openai'||typeof body.enabled!=='boolean'||!Number.isSafeInteger(body.expected_revision)))throw new AssistantError('configuration_invalid',400);
 return body;
}
export async function dispatch(body,{rpc,get,signal,transport}){
 validateBody(body);
 const {action,...args}=body;
 const configResponse=await rpc(action==='configuration'||action==='configure'||action==='test'?'configuration':'status',{});
 const config=configResponse.config;
 const runtime=publicRuntime(config,get);
 if(action==='configuration')return {...configResponse,runtime};
 if(action==='status')return {runtime};
 if(action==='configure'){
  if(args.enabled&&!connection(config,get).ready)throw new AssistantError(runtime.blocker||'provider_not_authorized',409);
  const saved=await rpc('configure',args);return {...saved,runtime:publicRuntime(saved.config,get)};
 }
 if(action==='test'){
  const privateConnection=connection(config,get);
  if(privateConnection.blocker){await rpc('test_record',{provider_revision:config.provider_revision,outcome:'unavailable',error_code:privateConnection.blocker});return {outcome:'unavailable',code:privateConnection.blocker,runtime};}
  const begun=await rpc('test_begin',{request_id:args.request_id});
  if(begun.replayed)return {outcome:begun.state==='completed'?'verified':begun.state,runtime};
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
   const result=await generateText(claim,connection(config,get).key,{transport,signal});
   if(signal?.aborted)throw new AssistantError('cancelled',409);
   return await rpc('finish',{...args,lease_id:claim.lease_id,...result});
  }catch(error){const code=error instanceof AssistantError?error.code:'provider_unavailable';try{await rpc('finish',{...args,lease_id:claim.lease_id,error_code:code});}catch{}throw error;}
 }
 return rpc(action,args);
}
