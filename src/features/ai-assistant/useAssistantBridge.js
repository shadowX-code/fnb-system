import {createSdkVoiceBaseline} from './sdkVoiceBaseline.js';
import {useCallback,useEffect,useRef,useState} from 'react';
import {createRealtimeVoice} from './realtimeVoice.js';
import {assistantCall} from './nativeAssistantService.js';
const protocol='feedx.assistant.text.v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validAssistantMessage(event,source){
 const d=event.data;
 if(event.source!==source||event.origin!=='null'||!d||typeof d!=='object'||Array.isArray(d)||d.protocol!==protocol||!['ready','new','history','older','send','cancel'].includes(d.action))return false;
 if(Object.keys(d).some(k=>!['protocol','action','request_id','session_id','text'].includes(k)))return false;
 if(d.action!=='ready'&&!uuid.test(d.request_id||''))return false;
 if((d.action==='history'||d.action==='send'&&d.session_id!=null)&&!uuid.test(d.session_id||''))return false;
 return d.action!=='send'||typeof d.text==='string'&&d.text.trim().length>0&&d.text.length<=2000;
}
// A generic JSON message boundary. No renderer globals, credentials or business APIs cross it.
export function createAssistantBridge({getWindow,userId,call=assistantCall,storage=globalThis.sessionStorage,voice,onThread=()=>{}}){
 let generation=0,alive=true,active=null,current=null,cursor=null,bootstrapping=false,switching=false,loadingOlder=false;
 const key=`feedx.assistant.session.${userId}`;
 const post=(type,payload={})=>{if(alive)getWindow()?.postMessage({protocol,type,...payload},'*');};
 const error=(cause,request_id)=>post('error',{request_id,code:cause.code||'assistant_unavailable',message:cause.message||'Assistant unavailable.'});
 async function cancel(){
  voice?.stop?.();generation++;const a=active;active=null;a?.controller?.abort();
  const cancelTurn=turn=>call('cancel',{session_id:a.session_id,turn_id:turn.turn_id}).catch(()=>{});
  if(a?.turn_id)void cancelTurn(a);else if(a?.begin)void a.begin.then(cancelTurn).catch(()=>{});
 }
 async function list(){return (await call('session_list')).sessions;}
 function remember(id,title){
  current=id;onThread(id?{id,title:title||'New conversation'}:null);
  try{if(id)storage.setItem(key,id);else storage.removeItem(key);}catch{}
 }
 function titleChanged(title){if(current&&title)onThread({id:current,title});}
 function guardVoice(){if(voice?.isActive?.())throw new Error('End voice before changing conversations or sending a text message.');}

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
   if(turn.state==='completed'&&typeof turn.reply==='string'){titleChanged(turn.thread_title);post('result',{request_id:a.request_id,reply:turn.reply.slice(0,3000),evidence:turn.evidence||null,tool_state:turn.tool_state||null,created_at:turn.created_at,finished_at:turn.finished_at,usage:{input_tokens:turn.input_tokens,output_tokens:turn.output_tokens,model:turn.model,context:turn.context_usage}});}
   else error({code:turn.error_code||'request_timeout',message:turn.state==='cancelled'?'Response cancelled.':'This request did not complete. Retry with a new request.'},a.request_id);
  }catch(cause){if(alive&&generation===mine)error(cause,a.request_id);}
  finally{if(active===a)active=null;}
 }
 async function history(session_id,request_id,fallbackTitle){
  const mine=++generation;const r=await call('history',{session_id});if(!alive||generation!==mine)return;
  cursor=r.has_more?r.turns[0]?.seq:null;
  remember(session_id,r.title||fallbackTitle);post('history',{request_id,session_id,turns:r.turns,has_more:!!cursor});
  const running=r.turns.findLast(t=>!t.voice&&['running','pending'].includes(t.state));
  if(running){active={generation:mine,request_id:running.request_id,session_id,turn_id:running.id,controller:new AbortController()};post('resume',{request_id:running.request_id});void runTurn(active,running.state);}
 }
 async function transition(action,session_id,request_id){
  guardVoice();
  if(switching||bootstrapping)throw new Error('Wait for the conversation to load.');
  switching=true;
  try{
   await cancel();
   const mine=generation;
   if(action==='delete'){
    await call('session_delete',{session_id});
    if(!alive||generation!==mine||current!==session_id)return;
    remember(null);cursor=null;post('empty');
    const first=(await list())[0];
    if(alive&&generation===mine&&first)await history(first.id,request_id,first.title);
    return;
   }
   if(action==='new'){remember(null);cursor=null;post('empty');return;}
   if(alive&&generation===mine)await history(session_id,request_id);
  }finally{switching=false;}
 }
 async function older(){
  if(!current||!cursor||loadingOlder)return;
  const mine=generation,session_id=current;
  loadingOlder=true;
  try{
   const r=await call('history',{session_id,before_seq:cursor});
   if(!alive||generation!==mine||current!==session_id)return;
   cursor=r.has_more?r.turns[0]?.seq:null;
   post('older',{session_id,turns:r.turns,has_more:!!cursor});
  }catch(cause){if(alive&&current===session_id)post('history_error',{message:cause.message});}
  finally{loadingOlder=false;}
 }
 async function receive(event){
  if(!validAssistantMessage(event,getWindow())||!alive)return;
  const d=event.data;
  try{
   if(d.action==='cancel'){await cancel();post('cancelled',{request_id:d.request_id});return;}
   if(d.action==='ready'){
    if(bootstrapping||voice?.isActive?.())return;
    bootstrapping=true;
    try{
     await cancel();const mine=generation;post('reset');
     const runtime=r=>({ready:r.ready,connection_ready:r.connection_ready,runtime_available:r.runtime_available,blocker:r.blocker,model:r.model,tools:r.tools,voice_provider:r.realtime?.openai?'OpenAI Realtime SDK':r.realtime?.grok?'Grok Voice':null});
     void call('status').then(({runtime:r})=>{
      if(!alive)return;
      voice?.setAvailable?.(r);post('runtime',{runtime:runtime(r)});
     }).catch(()=>{
      if(!alive)return;
      voice?.setAvailable?.({});post('runtime',{runtime:{ready:false}});
     });
     const sessions=await list();
     if(!alive||generation!==mine)return;
     const fallback=sessions.find(s=>s.title&&s.title!=='New conversation')||sessions[0];
     let preferred;try{preferred=storage.getItem(key);}catch{}
     post('bootstrap');
     if(uuid.test(preferred||'')){
      try{await history(preferred,undefined,sessions.find(s=>s.id===preferred)?.title);return;}
      catch(cause){if(cause.code!=='session_unavailable')throw cause;}
     }
     if(fallback)await history(fallback.id,undefined,fallback.title);
     else{remember(null);cursor=null;post('empty');}
     return;
    }finally{bootstrapping=false;}
   }
   if(d.action==='older'){await older();return;}
   if(d.action==='new'||d.action==='history'){await transition(d.action,d.session_id,d.request_id);return;}
   guardVoice();
   if(switching||d.session_id!==current)throw new Error('Select a conversation before sending a message.');
   await cancel();
   if(!current){const mine=generation;switching=true;try{const created=await call('session_new');if(!alive||mine!==generation)return;remember(created.session_id);post('session',{session_id:created.session_id});}finally{switching=false;}}
   active={generation,session_id:current,request_id:d.request_id,text:d.text,controller:new AbortController()};void runTurn(active);
  }catch(cause){if(alive)error(cause,d.request_id);}
 }
 return {receive,transition,titleChanged,async ensureSession(){if(current)return current;if(switching||bootstrapping)throw new Error('Wait for the conversation to load.');switching=true;try{const created=await call('session_new');remember(created.session_id);post('history',{session_id:current,turns:[],has_more:false});return current;}finally{switching=false;}},interrupt(){void cancel();post('cancelled');},getSession:()=>!switching&&!bootstrapping?current:null,post,destroy(){void cancel();post('reset');alive=false;}};
}
export default function useAssistantBridge(frame,userId){
 const realtimeRef=useRef(null),bridgeRef=useRef(null),[thread,setThread]=useState(null),[textReady,setTextReady]=useState(null),[realtimeState,setRealtimeState]=useState({state:'idle',available:false,active:false});
 useEffect(()=>{
  if(!userId)return;
  let bridge;
  let available={},voiceDefault,voicePolicy,alive=true,realtime,controllerProvider,voiceLocked=false,availabilityRefresh;
  function updateRealtime(state){
   voiceLocked=!!state.active||state.state==='connecting';
   bridge?.post('voice_lock',{active:voiceLocked});
   const sdkVoice=voiceDefault?.provider==='openai';
   setRealtimeState({...state,available,voiceDefault,sdkVoice,voicePolicy});
   if(sdkVoice&&state.report)void assistantCall('status').then(({runtime})=>{
    if(!alive)return;
    voicePolicy=runtime.voice_policy;
    setRealtimeState(current=>({...current,voicePolicy}));
    clearTimeout(availabilityRefresh);if(voicePolicy?.state==='active_elsewhere')availabilityRefresh=setTimeout(()=>{if(alive&&!voiceLocked)void realtimeRef.current?.refresh();},12000);
   }).catch(()=>{});
  }
  realtimeRef.current={
   async start(provider,voice){
    if(voiceLocked||provider!==voiceDefault?.provider||!available[provider]||(provider==='openai'&&voicePolicy?.state!=='available'))return;
    if(!bridge.getSession()){try{await bridge.ensureSession();}catch(error){updateRealtime({state:'error',message:error.message});return;}}
    bridge.interrupt();
    if(controllerProvider!==provider){
     const createVoice=provider==='openai'?createSdkVoiceBaseline:createRealtimeVoice;
     realtime=createVoice({call:assistantCall,getSession:()=>bridge.getSession(),post:(type,value)=>{
      if(type==='voice_turn'&&value.session_id===bridge.getSession())bridge.titleChanged(value.turn?.thread_title);
      if(type==='voice_level')frame.current?.parentElement?.style.setProperty('--voice-level',String(value.level));
      bridge.post(type,value);
     },onChange:updateRealtime});
     controllerProvider=provider;
    }
    voiceLocked=true;bridge.post('voice_lock',{active:true});
    void realtime.start(provider,voice);
   },
   async refresh(){if(voiceLocked)return;try{const {runtime}=await assistantCall('status');if(alive&&!voiceLocked){available=runtime.realtime||{};voiceDefault=runtime.voice_default;voicePolicy=runtime.voice_policy;setTextReady(runtime.ready===true);updateRealtime({state:'idle',active:false});}}catch(error){if(alive&&!voiceLocked)updateRealtime({state:'error',message:error.message});}},
   stop(){realtime?.stop();},
   resume(){return realtime?.resume?.();},
  };
  bridge=createAssistantBridge({getWindow:()=>frame.current?.contentWindow,userId,onThread:setThread,voice:{
   isActive:()=>voiceLocked,
   stop(){realtime?.stop();},
   setAvailable(runtime){setTextReady(runtime.ready===true);available=runtime.realtime||{};voiceDefault=runtime.voice_default;voicePolicy=runtime.voice_policy;updateRealtime({state:'idle',active:false});}
  }});
  bridgeRef.current=bridge;
  // Provider readiness is host-owned and must not wait for the isolated visual program.
  void realtimeRef.current.refresh();
  const listener=e=>{void bridge.receive(e);};window.addEventListener('message',listener);
  frame.current?.contentWindow?.postMessage({protocol,type:'host-ready'},'*');
  const hidden=()=>{if(document.hidden)realtime?.stop();};document.addEventListener('visibilitychange',hidden);
  return()=>{alive=false;clearTimeout(availabilityRefresh);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('message',listener);bridge.destroy();bridgeRef.current=null;realtimeRef.current=null;};
 },[frame,userId]);
 const setHudView=useCallback(immersive=>{
  frame.current?.contentWindow?.postMessage({protocol,type:'view',immersive},'*');
 },[frame]);
 const threadAction=useCallback((action,id)=>{
  if(!bridgeRef.current)throw new Error('Wait for AI Assistant to load.');
  return bridgeRef.current.transition(action,id);
 },[]);
 const renameThread=useCallback(async(id,title)=>{
  const bridge=bridgeRef.current;
  const result=await assistantCall('session_rename',{session_id:id,title});
  if(bridgeRef.current===bridge&&bridge?.getSession()===id)bridge.titleChanged(result.title);
  return result;
 },[]);
 return {realtimeState,realtimeRef,refreshAvailability:()=>realtimeRef.current?.refresh(),setHudView,thread,threadAction,renameThread,textReady};
}
