import { grokTransport, openAiTransport } from './realtimeTransports.js';

export const voiceOptions = { openai: ['cedar', 'marin', 'echo', 'ash', 'alloy'], grok: ['eve'] };
export const voicePreferenceKey = userId => `feedx.assistant.voice.${userId}`;

export function createRealtimeVoice({ call, getSession, post, onChange }) {
 let active, report;
 function update(state, message = '') {
  onChange({ state, message, active: !!active, report });
  post('voice_state', { state: state === 'thinking' ? 'transcribing' : state });
 }
 function stop(message = '', state = 'idle') {
  const connection = active;
  active = null;
  if (connection) {
   connection.interrupt?.();
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
  report = { firstAudioMs: null, durationMs: 0, inputAudio: 0, outputAudio: 0, inputText: 0, outputText: 0, usageReported: false, startsDuringPlayback: 0, shortSpeech: 0 };
  update('connecting');
  const fail = () => {
   if (isCurrent()) stop('Voice connection ended. Start voice to reconnect.', 'error');
  };
  connection.timer = setTimeout(fail, 25000);
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
   for (const track of stream.getAudioTracks()) track.onended = fail;
   const byItem=new Map();
   let currentTurn, speechStartedAt, playing=false;
   function record(turn,step,text=''){
    if(!turn)return;
    const payload={...lease,turn_id:turn.id,step,text};
    connection.writes=connection.writes.then(async()=>{
     const saved=await call('realtime_turn',payload);
     if(getSession()===session_id)post('voice_turn',{session_id,turn:saved});
    }).catch(()=>{
     if(isCurrent())post('voice_error',{message:'A voice transcript could not be saved.'});
    });
    return connection.writes;
   }
   function settle(turn,interrupted=false){
    if(!turn||turn.finished||(!interrupted&&(!turn.done||!turn.drained)))return;
    turn.finished=true;
    record(turn,interrupted?'interrupted':turn.spoken?'complete':'unavailable',interrupted?'':turn.spoken||'');
   }
   connection.interrupt=()=>settle(currentTurn,true);
   let speechEnded, turns = 0, generation = 0, responseId, blockedResponse, pending, executing = false;
   const seen = new Set();
   const speak = () => {
    playing=true;
    if(currentTurn)currentTurn.played=true;
    if (speechEnded !== undefined && report.firstAudioMs === null) report.firstAudioMs = Math.round(performance.now() - speechEnded);
    update('speaking');
   };
   async function tool(event, stamp) {
    if (executing || seen.has(event.call_id)) return;
    executing = true;
    seen.add(event.call_id);
    update('executing');
    const turn=currentTurn;
    let output;
    try {
     await connection.writes;
     if(!isCurrent()||generation!==stamp||!turn)return;
     output = await call('realtime_tool', { ...lease, turn_id:turn.id, arguments: JSON.parse(event.arguments) }, controller.signal);
    } catch {
     output = { error: 'Current Finished Goods evidence unavailable. Do not infer stock.' };
    } finally {
     executing = false;
    }
    if (!isCurrent() || generation !== stamp) return;
    transport.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(output) } });
    transport.send({ type: 'response.create' });
    update('thinking');
   }
   const onEvent = event => {
    if (!isCurrent()) return;
    switch (event.type) {
     case 'session.created':
     case 'session.updated':
      if (provider === 'grok' && event.type !== 'session.updated') break;
      clearTimeout(connection.timer);
      connection.timer = setTimeout(() => stop('The three-minute voice evaluation ended.'), 180000);
      update('listening');
      break;
     case 'input_audio_buffer.speech_started':
      speechStartedAt=performance.now();
      if(playing)report.startsDuringPlayback++;
      const interrupted=!!currentTurn&&!currentTurn.finished;
      settle(currentTurn,true);
      playing=false;
      generation++;
      pending = null;
      blockedResponse = responseId;
      transport.clearAudio?.();
      update(interrupted?'interrupted':'listening');
      break;
     case 'input_audio_buffer.speech_stopped':
      if (++turns > 12) { stop('The voice evaluation reached its turn limit.'); break; }
      speechEnded = performance.now();
      if(speechStartedAt!==undefined&&speechEnded-speechStartedAt<350)report.shortSpeech++;
      if(typeof event.item_id==='string'&&!byItem.has(event.item_id)){
       currentTurn={id:crypto.randomUUID()};
       byItem.set(event.item_id,currentTurn);
       record(currentTurn,'start');
      }else currentTurn=byItem.get(event.item_id);
      update('thinking');
      break;
     case 'conversation.item.input_audio_transcription.delta':
     case 'conversation.item.input_audio_transcription.updated': {
      const turn=byItem.get(event.item_id);
      if(turn===currentTurn&&turn){
       turn.preview=(event.transcript||((turn.preview||'')+(event.delta||''))).slice(0,2000);
       post('voice_preview',{text:turn.preview});
      }
      break;
     }
     case 'conversation.item.input_audio_transcription.completed': {
      const turn=byItem.get(event.item_id);
      if(turn&&typeof event.transcript==='string'&&event.transcript.trim())record(turn,'input',event.transcript.slice(0,2000));
      if(turn===currentTurn)post('voice_preview',{text:''});
      break;
     }
     case 'conversation.item.input_audio_transcription.failed':
      post('voice_preview',{text:''});
      break;
     case 'response.output_audio_transcript.delta':
      if(event.response_id===responseId&&event.response_id!==blockedResponse&&typeof event.delta==='string'&&currentTurn) {
       currentTurn.outputPreview=((currentTurn.outputPreview||'')+event.delta).slice(0,3000);
       post('voice_preview',{text:currentTurn.outputPreview,assistant:true});
      }
      break;
     case 'response.output_audio_transcript.done':
      if(event.response_id===responseId&&event.response_id!==blockedResponse&&typeof event.transcript==='string'&&currentTurn)currentTurn.spoken=event.transcript.slice(0,3000);
      break;
     case 'response.created':
      responseId = event.response?.id;
      break;
     case 'output_audio_buffer.started':
      if(event.response_id!==blockedResponse&&transport.canPlay())speak();
      break;
     case 'output_audio_buffer.stopped':
      playing=false;
      if(currentTurn&&(!event.response_id||event.response_id===responseId)&&event.response_id!==blockedResponse){
       currentTurn.drained=true;
       if(currentTurn.played)settle(currentTurn);else settle(currentTurn,true);
      }
      post('voice_preview',{text:''});
      update('listening');
      break;
     case 'output_audio_buffer.cleared':
      playing=false;
      post('voice_preview',{text:''});
      break;
     case 'response.output_audio.delta':
      if (provider === 'grok' && (!blockedResponse || event.response_id !== blockedResponse) && typeof event.delta === 'string' && event.delta.length < 96000) {
       const turn=currentTurn;
       if(turn)turn.drained=false;
       transport.play(event.delta, () => {
        if(!isCurrent()||currentTurn!==turn)return;
        playing=false;
        if(turn){turn.drained=true;settle(turn);}
        post('voice_preview',{text:''});
        update('listening');
       });
       if (isCurrent() && connection.context.state === 'running') speak();
      }
      break;
     case 'response.function_call_arguments.done':
      if (event.name === 'read_factory_finished_goods' && typeof event.call_id === 'string' && (!blockedResponse || event.response_id !== blockedResponse)) pending = event;
      break;
     case 'response.done': {
      const usage = event.response?.usage;
      if (usage) {
       report.usageReported = true;
       report.inputAudio += usage.input_token_details?.audio_tokens || 0;
       report.outputAudio += usage.output_token_details?.audio_tokens || 0;
       report.inputText += usage.input_token_details?.text_tokens || 0;
       report.outputText += usage.output_token_details?.text_tokens || 0;
      }
      const request = pending;
      if (request && request.response_id === event.response?.id) {
       pending = null;
       if (event.response.status === 'completed') void tool(request, generation);
      } else if(currentTurn&&event.response?.id===responseId&&responseId!==blockedResponse){
       const output=event.response?.output?.flatMap(item=>item.content||[]).find(part=>['audio','output_audio'].includes(part.type));
       if(event.response.status==='completed'&&output){
        currentTurn.done=true;
        if(typeof output.transcript==='string'&&!currentTurn.spoken)currentTurn.spoken=output.transcript.slice(0,3000);
        settle(currentTurn);
       }else if(event.response.status==='cancelled'||event.response.status==='failed')settle(currentTurn,true);
      }
      break;
     }
     case 'playback_blocked':
      update('playback_blocked', 'Tap Resume audio to allow playback.');
      break;
     case 'error':
      fail();
      break;
    }
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
   if (isCurrent()) stop(error.name === 'NotAllowedError' ? 'Allow microphone access, then start voice again.' : error.message, 'error');
  }
 }
 return { start, stop, async resume() {
  const connection = active;
  try {
   await connection?.transport?.resume();
   if (connection && active === connection) update('listening');
  } catch {
   if (active === connection) update('playback_blocked', 'Playback is blocked. Check browser audio settings.');
  }
 } };
}
