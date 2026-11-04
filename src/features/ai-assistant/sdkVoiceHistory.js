// Observe SDK events without taking ownership of transport, playback or response creation.
export function createSdkVoiceHistory({ write, read, state, trace, id = () => crypto.randomUUID() }) {
 const inputs = new Map();
 const responses = new Map();
 let current, writes = Promise.resolve();

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
  if (type === 'response.created' && response?.id && current && !current.finished && !responses.has(response.id)) {
   const owner = { turn: current, number: responses.size + 1 };
   responses.set(response.id, owner);
   current.response = owner;
  }
  if (['output_audio_buffer.started', 'output_audio_buffer.cleared', 'output_audio_buffer.stopped'].includes(type)) {
   const owner = responses.get(response_id);
   trace(type, owner?.turn.number, owner?.number);
   return;
  }
  if (type !== 'response.done') return;
  const owner = responses.get(response?.id);
  const turn = owner?.turn;
  if (!turn || turn !== current || turn.finished) return;
  if (owner.tool || response.output?.some(item => item.type === 'function_call')) {
   trace('tool_response_done', turn.number, owner.number, response.status);
   return;
  }
  if (turn.response !== owner) return;
  if (response.status === 'cancelled') {
   finish(turn, 'interrupted', undefined, 'provider_cancelled', owner);
   return;
  }
  if (response.status !== 'completed') {
   const incomplete = response.status === 'incomplete';
   finish(turn, incomplete ? 'unfinished' : 'failed', undefined, incomplete ? 'provider_incomplete' : 'provider_failed', owner);
   return;
  }
  const text = response.output?.flatMap(item => item.role === 'assistant'
   ? (item.content || []).map(content => content.type === 'output_audio' || content.type === 'audio' ? content.transcript : null)
   : []).filter(Boolean).join(' ').slice(0, 3000);
  finish(turn, text ? 'complete' : 'unavailable', text, text ? 'provider_completed' : 'missing_assistant_transcript', owner);
 }

 return {
  receive,
  async tool(args, responseId) {
   const owner = responses.get(responseId);
   const turn = owner?.turn;
   if (!turn || turn !== current || turn.response !== owner || turn.finished || turn.toolPending || owner.tool) return { stale: true };
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
