import {createVoiceAudioMeter} from './voiceAudioMeter.js';
import {assistantErrors} from './nativeAssistantService.js';
import { createSdkVoiceHistory } from './sdkVoiceHistory.js';

// The SDK owns the peer, microphone, audio, cancellation and all response requests.
export function createSdkVoiceBaseline({ call, getSession, post, onChange }) {
 let active, finishing=false, closing=Promise.resolve();

 function show(state, message = '', report) {
  if(active&&['listening','thinking','executing','speaking','interrupted'].includes(state))active.phase=state;
  onChange({ state, message, active: !!active, report });
  post('voice_state', { state: state === 'thinking' ? 'transcribing' : state });
 }

 function stop(message = '', state = 'idle', reason = 'session_ended') {
  const run = active;
  if (!run) return closing;
  active = null;
  finishing=true;
  clearTimeout(run.timer);clearInterval(run.heartbeat);
  run.unwatch?.();run.meter?.close();
  post('voice_level', {level:0,bands:Array(20).fill(0),source:'none'});
  run.controller.abort();
  try{run.session?.close();}catch{}
  if(run.audio){run.audio.pause();run.audio.srcObject=null;}
  run.report.durationMs = Math.round(performance.now() - run.started);
  show('ending','Releasing the voice connection…');
  closing = Promise.all([run.observations, run.history?.close(reason)]).then(async()=>{
   if(!run.requested)return;
   await call('voice_usage_report',{request_id:run.lease.request_id,input_audio_tokens:run.report.usageReported?run.report.inputAudio:null,output_audio_tokens:run.report.usageReported?run.report.outputAudio:null,duration_ms:run.report.durationMs}).catch(()=>{});
   await call('realtime_end',run.lease);
  }).catch(()=>{message='Voice ended locally. Server cleanup is pending; check availability before reconnecting.';state='error';}).finally(()=>{
   finishing=false;show(state,message,run.report);
  });
  return closing;
 }

 async function start(provider, voice) {
  const session_id = getSession();
  if (provider !== 'openai' || !session_id || active || finishing) return;
  const lease = { session_id, request_id: crypto.randomUUID(), provider };
  const run = {
   lease,
   observations:Promise.resolve(),
   controller: new AbortController(),
   started: performance.now(),
   report: { firstAudioMs: null, detectedTurns: 0, startsDuringPlayback: 0, inputAudio: 0, outputAudio: 0, usageReported: false, events: [] },
  };
  active = run;
  run.phase='listening';
  run.meter=createVoiceAudioMeter({phase:()=>run.phase,emit:value=>{
   if(active!==run)return;
   post('voice_level',value);
   if(value.level>0){run.report.audioSamples=(run.report.audioSamples||0)+1;run.report.peakLevel=Math.max(run.report.peakLevel||0,value.level);run.report.audioSources={...run.report.audioSources,[value.source]:true};}
  }});
  void run.meter.resume();
  show('connecting');
  run.timer = setTimeout(() => stop('The SDK connection timed out.', 'error'), 25000);
  try {
   const { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, tool, backgroundResult } = await import('@openai/agents-realtime');
   if (active !== run) return;
   run.requested = true;
   const authorization = await call('realtime_sdk_connect', { ...lease, voice, connection_protocol:'server_webrtc_v1' }, run.controller.signal);
   if (active !== run) return;
   const history = createSdkVoiceHistory({
    async write(turn_id, step, text, details) {
     const turn = await call('realtime_turn', { ...lease, turn_id, step, text, ...(details?{details}:{}) });
     if (getSession() === session_id) post('voice_turn', { session_id, turn });
    },
    async read(turn_id, args) {
     await run.observations;
     run.controller.signal.throwIfAborted();
     return call('realtime_tool', { ...lease, turn_id, arguments: args }, run.controller.signal);
    },
    state: next => { if (active === run) show(next); },
    trace: (name, turn, response, reason) => event(name, undefined, { turn, response, reason }),
   });
   run.history = history;
   const tools = (authorization.tools || []).map(definition => tool({
    name: definition.name, description: definition.description, parameters: definition.parameters, strict: true,
    async execute(args, _context, details) {
     const result = await history.tool(args, details?.toolCall?.responseId);
     if (result.stale || active !== run) return backgroundResult('The voice turn has ended.');
     return result.evidence || result.error;
    },
   }));
   const agent = new RealtimeAgent({ name: 'FeedX voice assistant', instructions: authorization.instructions, tools });
   const audio=document.createElement('audio');audio.autoplay=true;audio.setAttribute('playsinline','');run.audio=audio;
   const transport = new OpenAIRealtimeWebRTC({...authorization.webrtc_url?{baseUrl:authorization.webrtc_url}:{},audioElement:audio});
   run.transport=transport;
   const session = new RealtimeSession(agent, {
    model: authorization.model,
    transport,
    config: {
     outputModalities: ['audio'],
     audio: {
      input: {
       transcription: { model: 'gpt-transcribe' },
       noiseReduction: { type: 'near_field' },
       turnDetection: { type: 'server_vad', threshold: 0.67, prefixPaddingMs: 350, silenceDurationMs: 850, createResponse: true, interruptResponse: true },
      },
      output: { voice },
     },
    },
   });
   run.session = session;
   let speechEnded, speaking = false;
   function event(name, state, details) {
    if (active !== run) return;
    run.report.events.push({ ms: Math.round(performance.now() - run.started), event: name, ...details });
    if (run.report.events.length > 120) run.report.events.shift();
    if (state) show(state);
   }
   session.on('audio_start', () => {
    if (active !== run) return;
    speaking = true;
    if (run.report.firstAudioMs === null && speechEnded !== undefined) run.report.firstAudioMs = Math.round(performance.now() - speechEnded);
    event('audio_started', 'speaking');
   });
   session.on('audio_stopped', () => {
    speaking = false;
    event('audio_stopped', 'listening');
   });
   session.on('audio_interrupted', () => {
    speaking = false;
    event('audio_interrupted', 'interrupted');
   });
   session.on('transport_event', raw => {
    if (active !== run) return;
    const { type, response } = raw;
    if (type === 'input_audio_buffer.speech_started' && run.report.detectedTurns >= 12) {
     stop('This call reached its 12-turn safety limit. Start voice to continue.', 'idle', 'turn_limit');
     return;
    }
    history.receive(raw);
    if (type === 'input_audio_buffer.speech_started') {
     if (speaking) run.report.startsDuringPlayback++;
     event('speech_started');
    }
    if (type === 'response.done') {
     const usage = response?.usage;
     if (usage) {
      if(!run.report.usageReported)run.observations=run.observations.then(()=>call('realtime_sdk_observe',{...lease,milestone:'usage_observed'})).catch(()=>{});
      run.report.usageReported = true;
      run.report.inputAudio += usage.input_token_details?.audio_tokens || 0;
      run.report.outputAudio += usage.output_token_details?.audio_tokens || 0;
     }
     const status = response?.status;
     event(['completed','cancelled','failed','incomplete'].includes(status) ? 'response_' + status : 'response_done',undefined,{reason:['max_output_tokens','content_filter'].includes(response?.status_details?.reason)?response.status_details.reason:undefined});
    }
    if (type === 'input_audio_buffer.committed') {
     speechEnded = performance.now();
     run.report.detectedTurns++;
     event('speech_committed', 'thinking');
    }
   });
   session.on('error', () => {
    if (active === run && run.connected) stop('The voice provider reported an error. Partial replies were kept. Start voice to reconnect.', 'error', 'provider_error');
   });
   transport.on('connection_change', status => {
    if(['connecting','connected','disconnected'].includes(status))event('webrtc_'+status);
    if (status === 'disconnected' && run.connected && active === run) stop('Voice disconnected. Partial replies were kept. Start voice to reconnect.', 'error', 'transport_disconnected');
   });
   await session.connect({ apiKey: authorization.client_secret });
   if (active !== run) return;
   run.connected = true;
   run.observations=call('realtime_sdk_observe',{...lease,milestone:'connected'}).catch(()=>{});
   clearTimeout(run.timer);
   run.timer = setTimeout(() => stop('The session duration limit was reached. Start voice to continue.', 'idle', 'session_expired'), (authorization.maximum_seconds||180)*1000);
   run.deadline=Date.now()+(authorization.maximum_seconds||180)*1000;
   run.lastLease=Date.now();
   function leaseFailure(error){
    if(active!==run)return;
    if(error.code==='voice_session_expired')return stop('Voice expired or was revoked. Reconnect voice to continue.','error','session_expired');
    if(Date.now()-run.lastLease>=30000)return stop('The voice lease could not be checked. Reconnect after availability is restored.','error','lease_failed');
    event('lease_check_deferred','reconnecting');
   }
   let checking;
   run.reconcile=()=>{
    if(active!==run)return Promise.resolve();
    if(document.hidden){event('page_background');run.meter.pause();return Promise.resolve();}
    if(checking)return checking;
    checking=(async()=>{
     if(Date.now()>=run.deadline){await stop('Voice expired. Start voice to continue.','idle','session_expired');return;}
     try{
      const checked=await call('realtime_heartbeat',lease);
      if(active!==run)return;
      run.lastLease=Date.now();
      if(checked.expires_at){run.deadline=Date.parse(checked.expires_at);clearTimeout(run.timer);run.timer=setTimeout(()=>stop('Voice expired. Start voice to continue.','idle','session_expired'),Math.max(0,run.deadline-Date.now()));}
      const peer=transport.connectionState.peerConnection;
      const microphone=peer?.getSenders().find(s=>s.track?.kind==='audio')?.track;
      if(!peer||['closed','failed'].includes(peer.connectionState)||microphone?.readyState==='ended'){
       await stop('Voice disconnected or its microphone ended. Reconnect voice to continue.','error','transport_disconnected');return;
      }
      if(peer.connectionState==='disconnected'||transport.connectionState.dataChannel?.readyState!=='open'){
       event('background_reconciling','reconnecting');return;
      }
      await run.meter.resume(peer);
      if(microphone?.muted){show('suspended','The browser has suspended the microphone. Keep this tab active, or end and restart Voice.');return;}
      if(audio.paused&&audio.srcObject){try{await audio.play();}catch{show('playback_blocked','Tap Resume audio to continue the existing call.');return;}}
      if(active===run){event('session_reconciled');show(run.phase);}
     }catch(error){await leaseFailure(error);}
    })().finally(()=>{checking=null;});
    return checking;
   };
   if(authorization.webrtc_url)run.heartbeat=setInterval(()=>{
    // Keep the bounded lease alive in background tabs; visualization alone is suspended.
    if(document.hidden){void call('realtime_heartbeat',lease).then(()=>{if(active===run)run.lastLease=Date.now();}).catch(leaseFailure);}
    else void run.reconcile();
   },15000);
   const peer=transport.connectionState.peerConnection;
   const changed=()=>{if(active!==run)return;if(peer.connectionState==='disconnected')event('peer_recovering','reconnecting');else if(peer.connectionState==='connected')void run.reconcile();};
   peer?.addEventListener('connectionstatechange',changed);
   const microphone=peer?.getSenders().find(s=>s.track?.kind==='audio')?.track;
   const mediaChanged=()=>void run.reconcile();
   for(const type of ['ended','mute','unmute'])microphone?.addEventListener?.(type,mediaChanged);
   run.unwatch=()=>{peer?.removeEventListener('connectionstatechange',changed);for(const type of ['ended','mute','unmute'])microphone?.removeEventListener?.(type,mediaChanged);};
   await run.meter.resume(peer);
   void run.reconcile();
   show('listening');
  } catch (error) {
   if (active === run) {
    const safeNames=['NotAllowedError','NotFoundError','NotReadableError','InvalidStateError','OperationError','AbortError'];
    const name=safeNames.includes(error.name)?error.name:'unclassified';
    run.report.events.push({ms:Math.round(performance.now()-run.started),event:run.session?'sdk_connect_failed':'sdk_authorization_failed',reason:name});
   }
   const returnedCode=/["']error["']\s*:\s*["']([a-z_]+)["']/.exec(error.message||'')?.[1];
   if(returnedCode&&Object.hasOwn(assistantErrors,returnedCode)){error.code=returnedCode;error.message=assistantErrors[returnedCode];}
   if (active === run) stop(error.name === 'NotAllowedError' ? 'Allow microphone access and try again.' : error.code ? error.message : 'The SDK could not connect to OpenAI Realtime.', 'error');
  }
 }

 return { start, stop, reconcile(){return active?.reconcile?.();}, async resume(){const run=active;if(!run)return;try{await run.audio?.play();await run.reconcile?.();}catch{if(active===run)show('playback_blocked','Audio is still paused by the browser. Keep this tab active and try Resume audio.');}} };
}
