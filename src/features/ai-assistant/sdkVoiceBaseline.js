import { createSdkVoiceHistory } from './sdkVoiceHistory.js';

// The SDK owns the peer, microphone, audio, cancellation and all response requests.
export function createSdkVoiceBaseline({ call, getSession, post, onChange }) {
 let active;

 function show(state, message = '', report) {
  onChange({ state, message, active: !!active, report });
  post('voice_state', { state: state === 'thinking' ? 'transcribing' : state });
 }

 function stop(message = '', state = 'idle') {
  const run = active;
  if (!run) return;
  active = null;
  clearTimeout(run.timer);
  run.controller.abort();
  run.session?.close();
  if (run.requested) void Promise.all([run.observations, run.history?.close()])
   .then(() => call('realtime_end', run.lease)).catch(() => {});
  run.report.durationMs = Math.round(performance.now() - run.started);
  show(state, message, run.report);
 }

 async function start(provider, voice) {
  const session_id = getSession();
  if (provider !== 'openai' || !session_id || active) return;
  const lease = { session_id, request_id: crypto.randomUUID(), provider };
  const run = {
   lease,
   observations:Promise.resolve(),
   controller: new AbortController(),
   started: performance.now(),
   report: { firstAudioMs: null, detectedTurns: 0, startsDuringPlayback: 0, inputAudio: 0, outputAudio: 0, usageReported: false, events: [] },
  };
  active = run;
  show('connecting');
  run.timer = setTimeout(() => stop('The SDK connection timed out.', 'error'), 25000);
  try {
   const { RealtimeAgent, RealtimeSession, OpenAIRealtimeWebRTC, tool, backgroundResult } = await import('@openai/agents-realtime');
   if (active !== run) return;
   run.requested = true;
   const authorization = await call('realtime_sdk_connect', { ...lease, voice }, run.controller.signal);
   if (active !== run) return;
   const history = createSdkVoiceHistory({
    async write(turn_id, step, text) {
     const turn = await call('realtime_turn', { ...lease, turn_id, step, text });
     if (getSession() === session_id) post('voice_turn', { session_id, turn });
    },
    async read(turn_id, args) {
     await run.observations;
     run.controller.signal.throwIfAborted();
     return call('realtime_tool', { ...lease, turn_id, arguments: args }, run.controller.signal);
    },
    state: next => { if (active === run) show(next); },
    trace: name => event(name),
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
   const transport = new OpenAIRealtimeWebRTC();
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
   function event(name, state) {
    if (active !== run) return;
    run.report.events.push({ ms: Math.round(performance.now() - run.started), event: name });
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
     stop('The voice evaluation reached its turn limit.');
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
     event(['completed','cancelled','failed','incomplete'].includes(status) ? 'response_' + status : 'response_done');
    }
    if (type === 'input_audio_buffer.committed') {
     speechEnded = performance.now();
     run.report.detectedTurns++;
     event('speech_committed', 'thinking');
    }
   });
   session.on('error', () => {
    if (active === run) stop('The SDK reported a Realtime error.', 'error');
   });
   transport.on('connection_change', status => {
    if(['connecting','connected','disconnected'].includes(status))event('webrtc_'+status);
    if (status === 'disconnected' && run.connected && active === run) stop('The SDK transport disconnected. Start voice to reconnect.', 'error');
   });
   await session.connect({ apiKey: authorization.client_secret });
   if (active !== run) return;
   run.connected = true;
   run.observations=call('realtime_sdk_observe',{...lease,milestone:'connected'}).catch(()=>{});
   clearTimeout(run.timer);
   run.timer = setTimeout(() => stop('The three-minute evaluation ended.'), 180000);
   show('listening');
  } catch (error) {
   if (active === run) {
    const safeNames=['NotAllowedError','NotFoundError','NotReadableError','InvalidStateError','OperationError','AbortError'];
    const name=safeNames.includes(error.name)?error.name:'unclassified';
    run.report.events.push({ms:Math.round(performance.now()-run.started),event:run.session?'sdk_connect_failed':'sdk_authorization_failed',reason:name});
   }
   if (active === run) stop(error.name === 'NotAllowedError' ? 'Allow microphone access and try again.' : error.code ? error.message : 'The SDK could not connect to OpenAI Realtime.', 'error');
  }
 }

 return { start, stop };
}
