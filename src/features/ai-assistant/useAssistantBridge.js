import {createSdkVoiceBaseline} from './sdkVoiceBaseline.js';
import {useEffect,useRef,useState} from 'react';
import {createRealtimeVoice} from './realtimeVoice.js';
import {createAssistantVoice} from './assistantVoice.js';
import {assistantCall} from './nativeAssistantService.js';
const protocol='feedx.assistant.text.v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validAssistantMessage(event,source){
 const d=event.data;
 if(event.source!==source||event.origin!=='null'||!d||typeof d!=='object'||Array.isArray(d)||d.protocol!==protocol||!['ready','new','history','send','cancel'].includes(d.action))return false;
 if(Object.keys(d).some(k=>!['protocol','action','request_id','session_id','text'].includes(k)))return false;
 if(d.action!=='ready'&&!uuid.test(d.request_id||''))return false;
 if(['history','send'].includes(d.action)&&!uuid.test(d.session_id||''))return false;
 return d.action!=='send'||typeof d.text==='string'&&d.text.trim().length>0&&d.text.length<=2000;
}
// A generic JSON message boundary. No renderer globals, credentials or business APIs cross it.
export function createAssistantBridge({getWindow,userId,call=assistantCall,storage=globalThis.sessionStorage,voice}){
 let generation=0,alive=true,active=null,current=null,known=new Set();
 const key=`feedx.assistant.session.${userId}`;
 const post=(type,payload={})=>{if(alive)getWindow()?.postMessage({protocol,type,...payload},'*');};
 const error=(cause,request_id)=>post('error',{request_id,code:cause.code||'assistant_unavailable',message:cause.message||'Assistant unavailable.'});
 async function cancel(){
  voice?.stop();generation++;const a=active;active=null;a?.controller?.abort();
  const cancelTurn=turn=>call('cancel',{session_id:a.session_id,turn_id:turn.turn_id}).catch(()=>{});
  if(a?.turn_id)void cancelTurn(a);else if(a?.begin)void a.begin.then(cancelTurn).catch(()=>{});
 }
 async function list(){const r=await call('session_list');known=new Set(r.sessions.map(s=>s.id));return r.sessions;}
 function remember(id){current=id;try{storage.setItem(key,id);}catch{}}
 async function runTurn(a,resumeState){
  const mine=a.generation;
  try{
   let turn;
   if(resumeState){turn={turn_id:a.turn_id,state:resumeState};}
   else{a.begin=call('begin',{session_id:a.session_id,request_id:a.request_id,text:a.text});turn=await a.begin;a.turn_id=turn.turn_id;}
   if(!alive||generation!==mine)return;
   if(turn.state==='completed'&&!turn.reply)turn=await call('turn_status',{session_id:a.session_id,turn_id:a.turn_id},a.controller.signal);
   if(['pending','running'].includes(turn.state))post('state',{request_id:a.request_id,state:'thinking'});
   if(turn.state==='pending'){
    let polling=false;const timer=setInterval(async()=>{if(polling||generation!==mine)return;polling=true;try{const status=await call('turn_status',{session_id:a.session_id,turn_id:a.turn_id},a.controller.signal);if(generation===mine&&status.tool_state==='executing')post('state',{request_id:a.request_id,state:'executing'});}catch{}finally{polling=false;}},700);
    try{turn=await call('respond',{session_id:a.session_id,turn_id:a.turn_id},a.controller.signal);}finally{clearInterval(timer);}
   }
   for(let i=0;alive&&generation===mine&&['running','pending'].includes(turn.state)&&i<40;i++){
    await new Promise(resolve=>{const done=()=>{clearTimeout(timer);a.controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,1000);a.controller.signal.addEventListener('abort',done,{once:true});});
    if(a.controller.signal.aborted)return;
    turn=await call('turn_status',{session_id:a.session_id,turn_id:a.turn_id},a.controller.signal);
   }
   if(!alive||generation!==mine)return;
   if(turn.state==='completed'&&typeof turn.reply==='string'){post('result',{request_id:a.request_id,reply:turn.reply.slice(0,3000),evidence:turn.evidence||null,tool_state:turn.tool_state||null});void voice?.speak(a.session_id,a.turn_id);}
   else error({code:turn.error_code||'request_timeout',message:turn.state==='cancelled'?'Response cancelled.':'This request did not complete. Retry with a new request.'},a.request_id);
  }catch(cause){if(alive&&generation===mine)error(cause,a.request_id);}
  finally{if(active===a)active=null;}
 }
 async function history(session_id,request_id){
  const mine=++generation;const r=await call('history',{session_id});if(!alive||generation!==mine)return;
  remember(session_id);post('history',{request_id,session_id,turns:r.turns});
  const running=r.turns.findLast(t=>['running','pending'].includes(t.state));
  if(running){active={generation:mine,request_id:running.request_id,session_id,turn_id:running.id,controller:new AbortController()};post('resume',{request_id:running.request_id});void runTurn(active,running.state);}
 }
 async function receive(event){
  if(!validAssistantMessage(event,getWindow())||!alive)return;
  const d=event.data;
  try{
   if(d.action==='cancel'){await cancel();post('cancelled',{request_id:d.request_id});return;}
   if(d.action==='ready'){
    await cancel();const mine=generation;post('reset');
    const [status,sessions]=await Promise.all([call('status'),list()]);if(!alive||generation!==mine)return;
    let preferred;try{preferred=storage.getItem(key);}catch{}
    if(!known.has(preferred)){const created=await call('session_new');if(!alive||generation!==mine)return;preferred=created.session_id;known.add(preferred);sessions.unshift({id:preferred,title:'New conversation'});}
    remember(preferred);const r=status.runtime;voice?.setAvailable(r);
    post('bootstrap',{runtime:{ready:r.ready,connection_ready:r.connection_ready,runtime_available:r.runtime_available,blocker:r.blocker,model:r.model,stt:r.stt,tts:r.tts,tools:r.tools},sessions:sessions.slice(0,6),session_id:preferred});
    await history(preferred);return;
   }
   if(d.action==='new'){
    await cancel();const mine=generation;const created=await call('session_new');const sessions=await list();if(!alive||generation!==mine)return;
    remember(created.session_id);post('sessions',{sessions,session_id:current});await history(current,d.request_id);return;
   }
   if(d.action==='history'){
    if(!known.has(d.session_id))throw new Error('Conversation unavailable.');await cancel();await history(d.session_id,d.request_id);return;
   }
   if(d.session_id!==current||!known.has(current))throw new Error('Conversation changed. Select it again.');
   await cancel();active={generation,session_id:current,request_id:d.request_id,text:d.text,controller:new AbortController()};void runTurn(active);
  }catch(cause){if(alive)error(cause,d.request_id);}
 }
 return {receive,interrupt(){void cancel();post('cancelled');},getSession:()=>current,post,destroy(){void cancel();post('reset');alive=false;}};
}
export default function useAssistantBridge(frame,userId){
 const realtimeRef=useRef(null),[realtimeState,setRealtimeState]=useState({state:'idle',available:false,active:false});
 const voiceRef=useRef(null),[voiceState,setVoiceState]=useState({state:'idle',stt:false,tts:false,output:false});
 useEffect(()=>{
  if(!userId)return;
  let bridge;
  let available={},voiceDefault;
  const sdkBaseline=new URLSearchParams(window.location.search).get('voiceRuntime')==='sdk';
  const createVoice=sdkBaseline?createSdkVoiceBaseline:createRealtimeVoice;
  const realtime=createVoice({call:assistantCall,getSession:()=>bridge?.getSession(),post:(type,value)=>bridge?.post(type,value),onChange:state=>setRealtimeState({...state,available,voiceDefault,sdkBaseline})});
  realtimeRef.current={...realtime,start(provider,voice){if(available[provider]){bridge.interrupt();void realtime.start(provider,voice);}}};
  const voice=createAssistantVoice({getSession:()=>bridge?.getSession(),post:(type,value)=>bridge?.post(type,value),beforeStart:()=>bridge?.interrupt(),onChange:setVoiceState});voiceRef.current=voice;
  bridge=createAssistantBridge({getWindow:()=>frame.current?.contentWindow,userId,voice:{
   ...voice,
   stop(){realtime.stop();voice.stop();},
   setAvailable(runtime){available=runtime.realtime||{};voiceDefault=runtime.voice_default;setRealtimeState({state:'idle',available,active:false,voiceDefault:runtime.voice_default,sdkBaseline});voice.setAvailable(runtime);}
  }});
  const listener=e=>{void bridge.receive(e);};window.addEventListener('message',listener);
  frame.current?.contentWindow?.postMessage({protocol,type:'host-ready'},'*');
  const hidden=()=>{if(document.hidden){realtime.stop();voice.stop();}};document.addEventListener('visibilitychange',hidden);
  return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('message',listener);bridge.destroy();voice.destroy();voiceRef.current=null;realtimeRef.current=null;};
 },[frame,userId]);
 return {voiceState,voiceRef,realtimeState,realtimeRef};
}
