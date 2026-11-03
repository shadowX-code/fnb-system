// Browser media stays in the authenticated host, never the opaque GPL HUD.
import {assistantCall} from './nativeAssistantService.js';
export function createAssistantVoice({getSession,post,onChange,beforeStart,call=assistantCall,media=globalThis.navigator?.mediaDevices}){
 let epoch=0,stream=null,recorder=null,controller=null,audio=null,url=null,timer=null,context=null,raf=null,output=false,available={stt:false,tts:false};
 const update=state=>{onChange?.({state,output,...available});post('voice_state',{state});};
 function stop(){epoch++;clearTimeout(timer);controller?.abort();controller=null;if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;recorder.stop();}recorder=null;stream?.getTracks().forEach(t=>t.stop());stream=null;if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio=null;}if(url)URL.revokeObjectURL(url);url=null;cancelAnimationFrame(raf);raf=null;void context?.close().catch(()=>{});context=null;update('idle');}
 function levels(source,mine){
  const analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);const bins=new Uint8Array(analyser.frequencyBinCount);let last=0;
  function frame(now){if(mine!==epoch)return;if(now-last>=80){analyser.getByteFrequencyData(bins);const level=Math.min(1,bins.reduce((a,b)=>a+b,0)/bins.length/100);post('voice_level',{level});last=now;}raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
 }
 async function start(){
  if(!available.stt||!media?.getUserMedia){update('unavailable');return;}
  beforeStart?.();stop();const mine=epoch,session_id=getSession();if(!session_id)return;update('permission');
  // Open/resume Web Audio in the host's own click handler for mobile activation.
  context=new (globalThis.AudioContext||globalThis.webkitAudioContext)();void context.resume();
  try{
   const acquired=await media.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(mine!==epoch){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
   const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw new Error('recording_unsupported');
   recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:32000});const parts=[];
   recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
   recorder.onstop=async()=>{
    stream?.getTracks().forEach(t=>t.stop());stream=null;cancelAnimationFrame(raf);void context?.close().catch(()=>{});context=null;if(mine!==epoch)return;
    const blob=new Blob(parts,{type:mime});parts.length=0;if(!blob.size||blob.size>1000000){update('error');return;}
    update('transcribing');controller=new AbortController();
    try{const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
     const result=await call('voice_stt',{session_id,request_id:crypto.randomUUID(),audio:btoa(binary),mime:mime.split(';')[0]},controller.signal);
     if(mine!==epoch||session_id!==getSession())return;update('idle');if(result.text?.trim())post('transcript',{text:result.text});else update('empty');
    }catch(e){if(mine===epoch){update('error');post('voice_error',{message:e.message});}}
   };
   levels(context.createMediaStreamSource(stream),mine);recorder.start();update('listening');timer=setTimeout(finish,20000);
  }catch(e){if(mine===epoch){stop();update('error');post('voice_error',{message:'Microphone unavailable. Check browser permission and try again.'});}}
 }
 function finish(){clearTimeout(timer);if(recorder?.state==='recording')recorder.stop();}
 async function speak(session_id,turn_id){
  if(!output||!available.tts)return;stop();const mine=epoch;controller=new AbortController();update('preparing');
  try{const result=await call('voice_tts',{session_id,turn_id,request_id:crypto.randomUUID()},controller.signal);if(mine!==epoch||session_id!==getSession())return;
   const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio=new Audio(url);
   context=new (globalThis.AudioContext||globalThis.webkitAudioContext)();void context.resume();let metered=false;
   audio.onplaying=()=>{if(mine!==epoch)return;update('speaking');if(context&&!metered){metered=true;const source=context.createMediaElementSource(audio);source.connect(context.destination);levels(source,mine);}};
   audio.onended=()=>{if(mine===epoch)stop();};audio.onerror=()=>{if(mine===epoch){stop();update('error');}};
   // A rejected autoplay never becomes Speaking. Native Resume is exposed in the host.
   await audio.play();
  }catch(e){if(mine===epoch){update(audio?'playback_blocked':'error');post('voice_error',{message:audio?'Tap Play voice to allow browser playback.':e.message});}}
 }
 return {start,finish,stop,speak,setOutput(value){output=!!value;stop();},play(){void context?.resume();void audio?.play().catch(()=>update('playback_blocked'));},setAvailable(value){available={stt:!!value.stt,tts:!!value.tts};update('idle');},destroy(){stop();}};
}
