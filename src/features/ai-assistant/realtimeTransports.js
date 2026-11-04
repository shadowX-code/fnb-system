import captureUrl from './voiceCapture.worklet.js?url';

export function openAiTransport({ stream, connect, onEvent, onError, signal }) {
 const peer = new RTCPeerConnection();
 const audio = new Audio();
 audio.autoplay = true;
 audio.setAttribute('playsinline', '');
 const channel = peer.createDataChannel('oai-events');
 const resume = () => audio.play();
 const close = () => {
  peer.close();
  audio.pause();
  audio.srcObject = null;
 };
 signal.addEventListener('abort', close, { once: true });
 peer.ontrack = ({ streams }) => {
  audio.srcObject = streams[0];
  void resume().catch(() => onEvent({ type: 'playback_blocked' }));
 };
 peer.onconnectionstatechange = () => {
  if (['failed', 'disconnected'].includes(peer.connectionState)) onError();
 };
 channel.onclose = onError;
 channel.onmessage = ({ data }) => onEvent(JSON.parse(data));
 for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
 return {
  async start() {
   await peer.setLocalDescription(await peer.createOffer());
   const { sdp } = await connect({ sdp: peer.localDescription.sdp });
   await peer.setRemoteDescription({ type: 'answer', sdp });
  },
  send(event) { if (channel.readyState === 'open') channel.send(JSON.stringify(event)); },
  resume,
 };
}

export function grokTransport({ stream, context, connect, onEvent, onError, signal, voice }) {
 let socket, capture, input, cursor = 0, ready = false;
 const scheduled = new Set();
 const clearAudio = () => {
  for (const source of scheduled) source.stop();
  scheduled.clear();
  cursor = context.currentTime;
 };
 signal.addEventListener('abort', () => {
  socket?.close();
  capture?.disconnect();
  input?.disconnect();
  clearAudio();
 }, { once: true });
 function send(event) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
 }
 return {
  async start() {
   await context.audioWorklet.addModule(captureUrl);
   const { client_secret, instructions, tools } = await connect({});
   signal.throwIfAborted();
   socket = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest', 'xai-client-secret.' + client_secret);
   socket.onerror = socket.onclose = onError;
   const format = { type: 'audio/pcm', rate: 24000 };
   socket.onopen = () => send({ type: 'session.update', session: {
    voice, instructions, tools, turn_detection: { type: 'server_vad' },
    audio: { input: { format, transport: 'binary' }, output: { format } },
   } });
   socket.onmessage = ({ data }) => {
    if (signal.aborted || typeof data !== 'string') return;
    const event = JSON.parse(data);
    if (event.type === 'session.updated') ready = true;
    onEvent(event);
   };
   input = context.createMediaStreamSource(stream);
   capture = new AudioWorkletNode(context, 'feedx-voice-capture', { numberOfOutputs: 0 });
   capture.port.onmessage = ({ data }) => {
    if (ready && socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 24000) socket.send(data);
   };
   input.connect(capture);
  },
  send,
  clearAudio,
  resume: () => context.resume(),
  play(delta, onDrain) {
   const bytes = Uint8Array.from(atob(delta), char => char.charCodeAt(0));
   const pcm = new Int16Array(bytes.buffer);
   const buffer = context.createBuffer(1, pcm.length, 24000);
   const samples = buffer.getChannelData(0);
   for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
   const source = context.createBufferSource();
   source.buffer = buffer;
   source.connect(context.destination);
   source.onended = () => {
    if (scheduled.delete(source) && !scheduled.size) onDrain();
   };
   cursor = Math.max(cursor, context.currentTime);
   if (cursor - context.currentTime > 3) { onError(); return; }
   source.start(cursor);
   cursor += buffer.duration;
   scheduled.add(source);
  },
 };
}
