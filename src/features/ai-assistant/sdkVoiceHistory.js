// Observe SDK events without taking ownership of transport, playback or response creation.
export function createSdkVoiceHistory({ write, read, state, trace, id = () => crypto.randomUUID() }) {
 const inputs = new Map();
 const responses = new Map();
 let current, playing, writes = Promise.resolve();

 function save(turn, step, text = '') {
  const saved = writes.then(() => write(turn.id, step, text));
  writes = saved.catch(() => trace('history_write_failed'));
  return saved;
 }

 function finish(turn, step, text) {
  if (!turn || turn.finished) return;
  turn.finished = true;
  void save(turn, step, text).catch(() => {});
 }

 function receive({ type, item_id, response, response_id, transcript }) {
  if (type === 'input_audio_buffer.speech_started' && (playing || current?.toolPending)) {
   finish(playing || current, 'interrupted');
  }
  if (type === 'input_audio_buffer.committed' && item_id && !inputs.has(item_id)) {
   finish(current, 'unfinished');
   current = { id: id() };
   inputs.set(item_id, current);
   current.started = save(current, 'start');
   void current.started.catch(() => {});
  }
  if (type === 'conversation.item.input_audio_transcription.completed' && transcript?.trim()) {
   const turn = inputs.get(item_id);
   if (turn) void save(turn, 'input', transcript.slice(0, 2000)).catch(() => {});
  }
  if (type === 'response.created' && response?.id && current && !current.finished) {
   responses.set(response.id, current);
  }
  if (type === 'output_audio_buffer.started') playing = responses.get(response_id);
  if (type === 'output_audio_buffer.cleared') {
   finish(responses.get(response_id) || playing, 'interrupted');
   playing = undefined;
  }
  if (type === 'output_audio_buffer.stopped') {
   const turn = responses.get(response_id) || playing;
   if (playing === turn) playing = undefined;
   if (turn) {
    turn.playbackStopped = true;
    if (turn.reply) finish(turn, 'complete', turn.reply);
   }
  }
  if (type !== 'response.done') return;
  const turn = responses.get(response?.id);
  if (!turn || turn.finished) return;
  if (response.status !== 'completed') {
   finish(turn, response.status === 'cancelled' ? 'interrupted' : 'failed');
   return;
  }
  if (response.output?.some(item => item.type === 'function_call')) return;
  const text = response.output?.flatMap(item => item.role === 'assistant'
   ? (item.content || []).map(content => content.type === 'output_audio' || content.type === 'audio' ? content.transcript : null)
   : []).filter(Boolean).join(' ').slice(0, 3000);
  turn.reply = text || '';
  if (!text) finish(turn, 'unavailable');
  else if (turn.playbackStopped) finish(turn, 'complete', text);
 }

 return {
  receive,
  async tool(args, responseId) {
   const turn = responses.get(responseId);
   if (!turn || turn !== current || turn.finished || turn.toolPending) return { stale: true };
   turn.toolPending = true;
   state('executing');
   trace('factory_read_started');
   try {
    await turn.started;
    if (turn.finished || turn !== current) return { stale: true };
    const evidence = await read(turn.id, args);
    trace('factory_read_completed');
    return turn.finished || turn !== current ? { stale: true } : { evidence };
   } catch {
    trace('factory_read_failed');
    return turn.finished || turn !== current ? { stale: true } : { error: 'Current Factory stock is unavailable.' };
   } finally {
    turn.toolPending = false;
    if (!turn.finished && turn === current) state('thinking');
   }
  },
  close() {
   for (const turn of inputs.values()) finish(turn, 'unfinished');
   return writes;
  },
 };
}
