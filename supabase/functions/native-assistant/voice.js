import {AssistantError} from './provider.js';
export function voiceConnection(get){
 const url=get('NATIVE_ASSISTANT_VOICE_URL')||'',key=get('NATIVE_ASSISTANT_VOICE_KEY')||'';
 let valid=false;try{const u=new URL(url);valid=u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname);}catch{}
 const ready=valid&&key.length>=32&&key.length<1024&&get('NATIVE_ASSISTANT_VOICE_APPROVED_USE')==='native-assistant-staging-voice';
 return {url,key,ready};
}
export async function voiceRequest(path,body,get,{signal,transport=fetch}={}){
 const connection=voiceConnection(get);if(!connection.ready)throw new AssistantError('voice_not_configured',503);
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=setTimeout(abort,40000);
 try{
  const r=await transport(new URL(path,connection.url),{method:'POST',headers:{Authorization:`Bearer ${connection.key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
  if(!r.ok)throw new AssistantError(r.status===429?'voice_busy':'voice_runtime_unavailable',r.status===429?429:503);
  const reader=r.body.getReader();let size=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5000000){await reader.cancel();throw new AssistantError('voice_response_limit',502);}parts.push(value);}}finally{reader.releaseLock();}
  const raw=new Uint8Array(size);let i=0;for(const part of parts){raw.set(part,i);i+=part.length;}const result=JSON.parse(new TextDecoder().decode(raw));
  if(path==='/ready'&&(result.stt!=='whisper-base'||result.tts!=='kokoro-bm_george'))throw new AssistantError('voice_runtime_invalid',502);
  if(path==='/stt'&&(typeof result.text!=='string'||result.text.length>2000))throw new AssistantError('voice_runtime_invalid',502);
  if(path==='/tts'&&(typeof result.audio!=='string'||result.audio.length>4500000||result.mime!=='audio/wav'))throw new AssistantError('voice_runtime_invalid',502);
  return result;
 }catch(e){if(e instanceof AssistantError)throw e;throw new AssistantError(signal?.aborted?'cancelled':controller.signal.aborted?'voice_timeout':'voice_runtime_unavailable',503);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
