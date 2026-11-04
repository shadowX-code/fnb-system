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

 function finish(turn, step, text, reason = step, owner) {
  if (!turn || turn.finished) return;
  turn.finished = true;
  trace('turn_' + step, turn.number, owner?.number, reason);
  void save(turn, step, text).catch(() => {});
 }

 function receive({ type, item_id, response, response_id, transcript }) {
  if (type === 'input_audio_buffer.committed' && item_id && !inputs.has(item_id)) {
   finish(current, 'unfinished', undefined, 'next_input_committed');
   current = { id: id(), number: inputs.size + 1 };
   inputs.set(item_id, current);
   current.started = save(current, 'start');
   void current.started.catch(() => {});
  }
  if (type === 'conversation.item.input_audio_transcription.completed' && transcript?.trim()) {
   const turn = inputs.get(item_id);
   if (turn) void save(turn, 'input', transcript.slice(0, 2000)).catch(() => {});
  }
  if (type === 'response.created' && response?.id && current && !current.finished) {
   if (!responses.has(response.id)) responses.set(response.id, { turn: current, number: responses.size + 1 });
  }
  if (type === 'output_audio_buffer.started') {
   const owner = responses.get(response_id);
   if (owner && !owner.turn.finished) {
    playing = owner;
    owner.playbackStarted = true;
   }
  }
  if (type === 'output_audio_buffer.cleared' || type === 'output_audio_buffer.stopped') {
   const owner = response_id ? responses.get(response_id) : playing;
   if (!owner || !owner.playbackStarted) return;
   if (playing === owner) playing = undefined;
   if (type === 'output_audio_buffer.cleared') {
    if (!owner.playbackStopped && !owner.tool) finish(owner.turn, 'interrupted', undefined, 'playback_cleared', owner);
   } else {
    owner.playbackStopped = true;
    if (owner.reply) finish(owner.turn, 'complete', owner.reply, 'playback_stopped', owner);
   }
  }
  if (type !== 'response.done') return;
  const owner = responses.get(response?.id);
  const turn = owner?.turn;
  if (!turn || turn.finished) return;
  if (owner.tool || response.output?.some(item => item.type === 'function_call')) {
   trace('tool_response_done', turn.number, owner.number, response.status);
   return;
  }
  if (response.status !== 'completed') {
   const cancelled = response.status === 'cancelled';
   finish(turn, cancelled ? 'interrupted' : 'failed', undefined, cancelled ? 'provider_cancelled' : 'provider_failed', owner);
   return;
  }
  const text = response.output?.flatMap(item => item.role === 'assistant'
   ? (item.content || []).map(content => content.type === 'output_audio' || content.type === 'audio' ? content.transcript : null)
   : []).filter(Boolean).join(' ').slice(0, 3000);
  owner.reply = text;
  if (!text) finish(turn, 'unavailable', undefined, 'missing_assistant_transcript', owner);
  else if (owner.playbackStopped) finish(turn, 'complete', text, 'playback_stopped', owner);
 }

 return {
  receive,
  async tool(args, responseId) {
   const owner = responses.get(responseId);
   const turn = owner?.turn;
   if (!turn || turn !== current || turn.finished || turn.toolPending || owner.tool) return { stale: true };
   owner.tool = true;
   turn.toolPending = true;
   state('executing');
   trace('factory_read_started', turn.number, owner.number);
   try {
    await turn.started;
    if (turn.finished || turn !== current) return { stale: true };
    const evidence = await read(turn.id, args);
    trace('factory_read_completed', turn.number, owner.number);
    return turn.finished || turn !== current ? { stale: true } : { evidence };
   } catch {
    trace('factory_read_failed', turn.number, owner.number);
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
