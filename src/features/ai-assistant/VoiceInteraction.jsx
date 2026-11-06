import {Mic,Square} from 'lucide-react';
import {voiceOptions} from './realtimeVoice.js';

const labels={connecting:'Connecting',reconnecting:'Reconnecting',ending:'Ending voice',listening:'Listening',thinking:'Thinking',executing:'Reading Factory',speaking:'Speaking',interrupted:'Interrupted · listening',suspended:'Microphone suspended',playback_blocked:'Audio paused',error:'Connection error'};
export function voicePresentation(state){
 const provider=state.voiceDefault?.provider;
 const available=!!state.available?.[provider]&&(!state.sdkVoice||state.voicePolicy?.state==='available');
 const ending=state.state==='ending';
 return {available,disabled:ending||(!state.active&&!available),label:ending?'Ending…':state.active?'End voice':available?(state.state==='error'?'Reconnect voice':'Start voice'):({disabled:'Voice disabled',active_elsewhere:'Finishing previous call',capacity:'Voice busy',daily_limit:'Daily limit reached',approval_required:'Approval required'})[state.voicePolicy?.state]||'Voice unavailable',status:labels[state.state]||(available?'Ready':'Voice unavailable')};
}

// The same interaction node stays mounted in both layouts; the isolated text composer shares its lock.
export default function VoiceInteraction({state,controller,onRefresh,onUsage}){
 const {provider,voice:preferred}=state.voiceDefault||{};
 const view=voicePresentation(state);
 const primary=()=>state.active?controller.current?.stop():controller.current?.start(provider,voiceOptions[provider]?.includes(preferred)?preferred:voiceOptions[provider]?.[0]);
 return <div className="assistant-voice-dock" aria-label="Voice controls" data-phase={state.state}>
  <svg className="assistant-audio-bands" viewBox="0 0 400 64" aria-hidden="true">{Array.from({length:40},(_,i)=>{const index=i<20?i:39-i,x=i<20?i*6+4:282+(i-20)*6;return <line key={i} x1={x} x2={x} y1="7" y2="57" style={{transformOrigin:`${x}px 32px`,transform:`scaleY(calc(.025 + var(--voice-band-${index}, 0) * .975))`}}/>;})}</svg>
  <button type="button" className="assistant-mic-control" disabled={view.disabled} onClick={primary} aria-label={view.label}>{state.active?<Square size={20}/>:<Mic size={24}/>}<span>{view.label}</span></button>
  <p className="assistant-voice-state" role="status">{view.status}</p>
  {state.state==='playback_blocked'&&<button type="button" className="btn-ghost" onClick={()=>controller.current?.resume()}>Resume audio</button>}
  <details className="assistant-voice-availability"><summary>Voice status</summary>
   <p role="status">{state.message||(view.available?`Available · up to ${state.voicePolicy?.maximum_seconds||180} seconds per call. Provider charges and rate limits apply.`:state.voicePolicy?.state==='active_elsewhere'?'A previous call is awaiting server cleanup. Availability updates automatically; text remains available.':'Check provider availability and environment policy. Text remains available.')}</p>
   {state.active&&<p>Voice continues in supported background tabs. End Voice to type a message. Deep browser suspension may require reconnecting.</p>}
   <button type="button" className="btn-ghost" onClick={onUsage}>Usage &amp; limits</button>
   {!state.active&&<button type="button" className="btn-ghost" onClick={onRefresh}>Check availability</button>}
  </details>
  {!state.active&&state.report?.durationMs>0&&<details className="assistant-session-details"><summary>Session details</summary>
   <p>Call: {Math.round(state.report.durationMs/1000)} s · First audio signal: {state.report.firstAudioMs==null?'unavailable':state.report.firstAudioMs+' ms'} · {state.report.usageReported?`Audio tokens: ${state.report.inputAudio} in / ${state.report.outputAudio} out`:'Provider token usage unavailable'}</p>
   <p>Speech starts during playback: {state.report.startsDuringPlayback} · Committed speech turns: {state.report.detectedTurns}</p>
   <p>Audio meter: {state.report.audioSamples||0} non-silent samples · sources: {Object.keys(state.report.audioSources||{}).join(', ')||'none observed'} · peak: {Number(state.report.peakLevel||0).toFixed(2)}</p>
   <ol>{state.report.events?.map((event,index)=><li key={index}>{event.ms} ms · {event.event}{event.turn?' · turn '+event.turn:''}{event.response?' · response '+event.response:''}{event.reason?' · '+event.reason:''}</li>)}</ol>
  </details>}
 </div>;
}
