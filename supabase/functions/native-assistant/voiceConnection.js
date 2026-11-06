import {AssistantError} from './provider.js';
import {createRealtimeCall} from './realtime.js';
import {credentialEnvironment} from './providerRegistry.js';
export async function hashTicket(token){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function newTicket(){return 'ek_fx_'+crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');}
const validCall=id=>typeof id==='string'&&/^(rtc|call)_[A-Za-z0-9_-]{1,180}$/.test(id);
export async function hangup(callId,key,transport=fetch){
 if(!validCall(callId))throw new AssistantError('realtime_unavailable',502);
 try{const r=await transport('https://api.openai.com/v1/realtime/calls/'+callId+'/hangup',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(8000)});await r.body?.cancel();return r.status;}catch{return 0;}
}
export async function cleanupVoice(token,{connection,transport}){
 if(!/^[a-f0-9]{64}$/.test(token))throw new AssistantError('authentication_required',401);
 const rows=await connection('cleanup',{hash:await hashTicket(token)});
 await Promise.all(rows.map(async row=>{const status=await hangup(row.call_id,row.credential,transport);await connection('terminated',{actor:row.actor,request_id:row.request_id,status});}));
 return {processed:rows.length};
}
export async function connectVoice(request,token,{connection,registry,transport}){
 if(!/^ek_fx_[a-f0-9]{64}$/.test(token))throw new AssistantError('authentication_required',401);
 // Reject oversized/malformed offers before consuming the one-use ticket.
 const reader=request.body?.getReader();if(!reader)throw new AssistantError('invalid_request',400);
 let size=0;const chunks=[];try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw new AssistantError('invalid_request',400);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const sdp=new TextDecoder().decode(bytes);if(!sdp.startsWith('v=0'))throw new AssistantError('invalid_request',400);
 const lease=await connection('claim',{hash:await hashTicket(token)});
 let result,entry;
 try{
  entry=await registry(lease.actor,{provider:'openai'});
  if(entry.active_voice!==lease.config.voice)throw new AssistantError('configuration_changed',409);
  result=await createRealtimeCall({sdp,...lease.config},credentialEnvironment('openai',entry),{transport});
  if(!validCall(result.call_id))throw new AssistantError('realtime_call_binding_failed',502);
  const bound=await connection('bind',{actor:lease.actor,request_id:lease.request_id,call_id:result.call_id,provider_revision:entry.revision});
  if(bound.state!=='active')throw new AssistantError('voice_session_expired',409);
  return result;
 }catch(error){
  if(result?.call_id&&entry)await hangup(result.call_id,entry.credential,transport);
  // A network timeout has unknown upstream outcome: retain the slot until reconciliation.
  if(error.status===403||error.status===409||error.diagnostic?.http_status>=400&&error.diagnostic.http_status<500)await connection('failed',{actor:lease.actor,request_id:lease.request_id}).catch(()=>{});
  throw error;
 }
}

// Only the authenticated Edge actor and a stored closing lease can enter this path.
export async function endVoiceLease(actor,lease,{end,connection,transport}){
 await end(lease);
 const row=await connection('owned_cleanup',{actor,request_id:lease.request_id,session_id:lease.session_id});
 if(!row.call_id||!row.credential)return {state:row.state};
 const status=await hangup(row.call_id,row.credential,transport);
 await connection('terminated',{actor,request_id:lease.request_id,status});
 return {state:[200,204,404].includes(status)?'closed':'closing'};
}
