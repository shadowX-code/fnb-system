// This connection belongs to the authenticated host, outside the isolated HUD.
export const voiceOptions = ['cedar', 'marin', 'echo', 'ash', 'alloy'];
export const voicePreferenceKey = userId => `feedx.assistant.voice.${userId}`;

export function createRealtimeVoice({ call, getSession, post, onChange }) {
 let active, report;
 function update(state, message = '') {
  onChange({ state, message, active: !!active, report });
  post('voice_state', { state: state === 'connecting' ? 'permission' : state === 'thinking' ? 'transcribing' : state });
 }
 function stop(message = '', state = 'idle') {
  const connection = active;
  active = null;
  if (connection) {
   clearTimeout(connection.timer);
   connection.controller.abort();
   connection.stream?.getTracks().forEach(track => track.stop());
   connection.peer.close();
   connection.audio.pause();
   connection.audio.srcObject = null;
  }
  update(state, message);
 }
 async function start(voice) {
  const session_id = getSession();
  if (active || !session_id || !voiceOptions.includes(voice)) return;
  if (!globalThis.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
   update('error', 'Voice requires a browser with microphone and WebRTC support.');
   return;
  }
  const peer = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  const controller = new AbortController();
  report = { firstAudioMs: null, inputAudio: 0, outputAudio: 0, inputText: 0, outputText: 0 };
  const connection = { peer, audio, controller, speechEndedAt: null, outputPlaying: false };
  active = connection;
  update('connecting');
  try {
   const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
   if (active !== connection) {
    stream.getTracks().forEach(track => track.stop());
    return;
   }
   connection.stream = stream;
   stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
   audio.onplaying = () => {
    if (active === connection && connection.outputPlaying) markSpeaking();
   };
   function markSpeaking() {
    if (report.firstAudioMs === null && connection.speechEndedAt !== null) report.firstAudioMs = Math.round(performance.now() - connection.speechEndedAt);
    update('speaking');
   }
   peer.ontrack = ({ streams }) => {
    if (active !== connection) return;
    audio.srcObject = streams[0];
    void audio.play().catch(() => {
     if (active === connection) update('playback_blocked', 'Tap Resume audio to allow playback.');
    });
   };
   peer.onconnectionstatechange = () => {
    if (active !== connection) return;
    if (['failed', 'disconnected'].includes(peer.connectionState)) stop('Voice connection dropped. Start voice to reconnect.', 'error');
   };
   const channel = peer.createDataChannel('oai-events');
   channel.onclose = () => {
    if (active === connection) stop('Voice connection ended. Start voice to reconnect.', 'error');
   };
   channel.onmessage = ({ data }) => {
    if (active !== connection) return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    switch (event.type) {
     case 'session.created':
     case 'input_audio_buffer.speech_started':
      update('listening');
      break;
     case 'output_audio_buffer.stopped':
     case 'output_audio_buffer.cleared':
      connection.outputPlaying = false;
      update('listening');
      break;
     case 'input_audio_buffer.speech_stopped':
      connection.speechEndedAt = performance.now();
      update('thinking');
      break;
     case 'output_audio_buffer.started':
      connection.outputPlaying = true;
      if (!audio.paused) markSpeaking();
      break;
     case 'response.done': {
      const usage = event.response?.usage;
      if (usage) {
       report.inputAudio += usage.input_token_details?.audio_tokens || 0;
       report.outputAudio += usage.output_token_details?.audio_tokens || 0;
       report.inputText += usage.input_token_details?.text_tokens || 0;
       report.outputText += usage.output_token_details?.text_tokens || 0;
      }
      break;
     }
     case 'error':
      stop('Realtime voice could not continue. Start voice again or use text.', 'error');
      break;
    }
   };
   await peer.setLocalDescription(await peer.createOffer());
   const result = await call('realtime_connect', { session_id, request_id: crypto.randomUUID(), sdp: peer.localDescription.sdp, voice }, controller.signal);
   if (active !== connection) return;
   await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
   if (active !== connection) return;
   connection.timer = setTimeout(() => stop('The three-minute voice evaluation ended.'), 180000);
  } catch (error) {
   if (active !== connection) return;
   stop(error.name === 'NotAllowedError' ? 'Allow microphone access, then start voice again.' : error.message, 'error');
  }
 }
 return { start, stop, resume() {
  const connection = active;
  if (!connection) return;
  void connection.audio.play().then(() => {
   if (active === connection) update(connection.outputPlaying ? 'speaking' : 'listening');
  }).catch(() => {
   if (active === connection) update('playback_blocked', 'Playback is blocked. Check browser audio settings.');
  });
 } };
}
