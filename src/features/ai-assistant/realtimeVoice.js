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
   clearTimeout(connection.timer);
   connection.controller.abort();
   connection.stream?.getTracks().forEach(track => track.stop());
   void connection.context?.close().catch(() => {});
   if (connection.requested) void call('realtime_end', connection.lease).catch(() => {});
   report.durationMs = Math.round(performance.now() - connection.started);
  }
  update(state, message);
 }
 async function start(provider, voice) {
  const session_id = getSession();
  if (active || !session_id || !voiceOptions[provider]?.includes(voice)) return;
  const controller = new AbortController();
  const lease = { session_id, request_id: crypto.randomUUID(), provider };
  const connection = { controller, lease, started: performance.now() };
  const isCurrent = () => active === connection;
  active = connection;
  report = { firstAudioMs: null, durationMs: 0, inputAudio: 0, outputAudio: 0, inputText: 0, outputText: 0, usageReported: false };
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
   let speechEnded, turns = 0, generation = 0, responseId, blockedResponse, pending, executing = false;
   const seen = new Set();
   const speak = () => {
    if (speechEnded !== undefined && report.firstAudioMs === null) report.firstAudioMs = Math.round(performance.now() - speechEnded);
    update('speaking');
   };
   async function tool(event, stamp) {
    if (executing || seen.has(event.call_id)) return;
    executing = true;
    seen.add(event.call_id);
    update('executing');
    let output;
    try {
     output = await call('realtime_tool', { ...lease, arguments: JSON.parse(event.arguments) }, controller.signal);
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
      generation++;
      pending = null;
      blockedResponse = responseId;
      transport.clearAudio?.();
      update('listening');
      break;
     case 'input_audio_buffer.speech_stopped':
      if (++turns > 12) { stop('The voice evaluation reached its turn limit.'); break; }
      speechEnded = performance.now();
      update('thinking');
      break;
     case 'response.created':
      responseId = event.response?.id;
      break;
     case 'output_audio_buffer.started':
      speak();
      break;
     case 'output_audio_buffer.stopped':
     case 'output_audio_buffer.cleared':
      update('listening');
      break;
     case 'response.output_audio.delta':
      if (provider === 'grok' && (!blockedResponse || event.response_id !== blockedResponse) && typeof event.delta === 'string' && event.delta.length < 96000) {
       transport.play(event.delta, () => { if (isCurrent()) update('listening'); });
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
