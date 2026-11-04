import {createRealtimeLifecycle} from './realtimeLifecycle.js';
import { grokTransport, openAiTransport } from './realtimeTransports.js';

export const voiceOptions = { openai: ['cedar', 'marin', 'echo', 'ash', 'alloy'], grok: ['eve'] };
export const voicePreferenceKey = userId => `feedx.assistant.voice.${userId}`;

export function createRealtimeVoice({ call, getSession, post, onChange }) {
 let active, report;
 function update(state, message = '') {
  onChange({ state, message, active: !!active, report });
  post('voice_state', { state: state === 'thinking' ? 'transcribing' : state });
 }
 function stop(message = '', state = 'idle', reason = 'session_shutdown') {
  const connection = active;
  active = null;
  if (connection) {
   connection.lifecycle?.close(reason);
   clearTimeout(connection.timer);
   connection.controller.abort();
   connection.stream?.getTracks().forEach(track => track.stop());
   void connection.context?.close().catch(() => {});
   if (connection.requested) void connection.writes.finally(()=>call('realtime_end',connection.lease)).catch(()=>{});
   report.durationMs = Math.round(performance.now() - connection.started);
  }
  post('voice_preview',{text:''});
  update(state, message);
 }
 async function start(provider, voice) {
  const session_id = getSession();
  if (active || !session_id || !voiceOptions[provider]?.includes(voice)) return;
  const controller = new AbortController();
  const lease = { session_id, request_id: crypto.randomUUID(), provider };
  const connection = { controller, lease, started: performance.now(), writes: Promise.resolve() };
  const isCurrent = () => active === connection;
  active = connection;
  report = { firstAudioMs: null, durationMs: 0, inputAudio: 0, outputAudio: 0, inputText: 0, outputText: 0, usageReported: false, startsDuringPlayback: 0, detectedTurns: 0, events: [] };
  update('connecting');
  const fail = (reason='transport_disconnect') => {
   if (isCurrent()) stop('Voice connection ended. Start voice to reconnect.', 'error',typeof reason==='string'?reason:'transport_disconnect');
  };
  connection.timer = setTimeout(()=>fail('connection_timeout'), 25000);
  try {
   if (provider === 'grok') {
    connection.context = new AudioContext({ sampleRate: 24000 });
    await connection.context.resume();
    if (connection.context.sampleRate !== 24000) throw new Error('This browser cannot capture 24 kHz audio for Grok.');
   }
   if (!isCurrent()) return;
   const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
   if (!isCurrent()) {
    stream.getTracks().forEach(track => track.stop());
    return;
   }
   connection.stream = stream;
   for (const track of stream.getAudioTracks()) track.onended = ()=>fail('microphone_ended');
   let speechEnded;
   const trace=(event,turn,response,reason)=>{
    report.events.push({ms:Math.round(performance.now()-connection.started),event,turn,response,reason});
    if(report.events.length>120)report.events.shift();
   };
   function record(turn,step,text=''){
    connection.writes=connection.writes.then(async()=>{
     const saved=await call('realtime_turn',{...lease,turn_id:turn.id,step,text});
     if(getSession()===session_id)post('voice_turn',{session_id,turn:saved});
    }).catch(()=>{
     trace('history_write_failed',turn.number);
     if(isCurrent())post('voice_error',{message:'A voice transcript could not be saved.'});
    });
   }
   const lifecycle=createRealtimeLifecycle({
    provider, isCurrent, trace, record, canHear:()=>!connection.playbackBlocked,
    send:event=>transport.send(event),
    preview:(text,assistant)=>post('voice_preview',{text,assistant}),
    state(next){
     if(next==='speaking'&&speechEnded!==undefined&&report.firstAudioMs===null)report.firstAudioMs=Math.round(performance.now()-speechEnded);
     update(next);
    },
    async readTool(turn,args){
     await connection.writes;
     controller.signal.throwIfAborted();
     return call('realtime_tool',{...lease,turn_id:turn.id,arguments:args},controller.signal);
    },
   });
   connection.lifecycle=lifecycle;
   const onEvent=event=>{
    if(!isCurrent())return;
    switch(event.type){
     case 'session.created':
     case 'session.updated':
      if(provider==='grok'&&event.type!=='session.updated')break;
      clearTimeout(connection.timer);
      connection.timer=setTimeout(()=>stop('The three-minute voice evaluation ended.','idle','time_limit'),180000);
      update('listening');
      break;
     case 'input_audio_buffer.speech_started':
      if(lifecycle.playing)report.startsDuringPlayback++;
      if(provider==='grok')transport.clearAudio?.();
      break;
     case 'input_audio_buffer.speech_stopped':
      speechEnded=performance.now();
      break;
     case 'response.output_audio.delta':
      if(provider==='grok'&&typeof event.delta==='string'&&event.delta.length<96000){
       const drain=lifecycle.grokAudio(event);
       if(drain)transport.play(event.delta,drain);
      }
      break;
     case 'response.done': {
      const usage=event.response?.usage;
      if(usage){
       report.usageReported=true;
       report.inputAudio+=usage.input_token_details?.audio_tokens||0;
       report.outputAudio+=usage.output_token_details?.audio_tokens||0;
       report.inputText+=usage.input_token_details?.text_tokens||0;
       report.outputText+=usage.output_token_details?.text_tokens||0;
      }
      break;
     }
     case 'playback_blocked':
      connection.playbackBlocked=true;
      trace('playback_blocked');
      update('playback_blocked','Tap Resume audio to allow playback.');
      break;
    }
    lifecycle.receive(event);
    report.detectedTurns=lifecycle.getTurnCount();
    if(report.detectedTurns>=12&&event.type==='input_audio_buffer.speech_started')stop('The voice evaluation reached its turn limit.','idle','turn_limit');
   };
   const options = {
    stream, context: connection.context, voice, onEvent, onError: fail, signal: controller.signal,
    async connect(extra) {
     controller.signal.throwIfAborted();
     connection.requested = true;
     return call('realtime_connect', { ...lease, voice, ...extra }, controller.signal);
    },
   };
   const transport = provider === 'grok' ? grokTransport(options) : openAiTransport(options);
   connection.transport = transport;
   await transport.start();
  } catch (error) {
   if (isCurrent()) stop(error.name === 'NotAllowedError' ? 'Allow microphone access, then start voice again.' : error.message, 'error','connection_failed');
  }
 }
 return { start, stop, async resume() {
  const connection = active;
  try {
   await connection?.transport?.resume();
   if (connection && active === connection) {connection.playbackBlocked=false;update('listening');}
  } catch {
   if (active === connection) update('playback_blocked', 'Playback is blocked. Check browser audio settings.');
  }
 } };
}
