// Observe SDK events without taking ownership of transport, playback or response creation.
export function createSdkVoiceHistory({ write, read, state, trace, activity = () => {}, id = () => crypto.randomUUID() }) {
 const inputs = new Map();
 const responses = new Map();
 let current, writes = Promise.resolve();

 function save(turn, step, text = '', details) {
  const saved = writes.then(() => write(turn.id, step, text, details));
  writes = saved.catch(() => trace('history_write_failed'));
  return saved;
 }

 function finish(turn, step, text, reason = step, owner) {
  if (!turn || turn.finished) return;
  turn.finished = true;
  activity({ turn_id: turn.id, phase: step });
  trace('turn_' + step, turn.number, owner?.number, reason);
  void save(turn, step, text || '', {reason}).catch(() => {});
 }

 function receive({ type, item_id, response, response_id, transcript, delta }) {
  if (type === 'input_audio_buffer.committed' && item_id && !inputs.has(item_id)) {
   current = { id: id(), number: inputs.size + 1 };
   inputs.set(item_id, current);
   activity({ turn_id: current.id, phase: 'processing' });
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
   if (type === 'output_audio_buffer.started' && owner && owner.turn.response === owner && !owner.turn.finished) {
    activity({ turn_id: owner.turn.id, phase: 'speaking' });
   }
   trace(type, owner?.turn.number, owner?.number);
   return;
  }
  if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta'].includes(type)) {
   const owner = responses.get(response_id);
   if (owner && typeof delta === 'string') owner.transcript = ((owner.transcript || '') + delta).slice(0, 3000);
  }
  if (['response.output_audio_transcript.done', 'response.audio_transcript.done'].includes(type)) {
   const owner = responses.get(response_id);
   if (owner && typeof transcript === 'string') owner.transcript = transcript.slice(0, 3000);
  }
  if (type !== 'response.done') return;
  const owner = responses.get(response?.id);
  const turn = owner?.turn;
  if (!turn || turn.finished || turn.response !== owner) return;
  if (response.status === 'completed' && (owner.tool || response.output?.some(item => item.type === 'function_call'))) {
   trace('tool_response_done', turn.number, owner.number, response.status);
   return;
  }
  const text = response.output?.flatMap(item => item.role === 'assistant'
   ? (item.content || []).map(content => content.type === 'output_audio' || content.type === 'audio' ? content.transcript : null)
   : []).filter(Boolean).join(' ').slice(0, 3000) || owner.transcript || '';
  if (response.status === 'cancelled') {
   finish(turn, 'interrupted', text, 'provider_cancelled', owner);
   return;
  }
  if (response.status !== 'completed') {
   const incomplete = response.status === 'incomplete';
   const reason = ['max_output_tokens', 'content_filter'].includes(response.status_details?.reason)
    ? response.status_details.reason : incomplete ? 'provider_incomplete' : 'provider_failed';
   finish(turn, incomplete ? 'unfinished' : 'failed', text, reason, owner);
   return;
  }
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
    const tool = { turn_id: turn.id, operation: owner.number };
    activity({ ...tool, phase: 'executing' });
    const evidence = await read(turn.id, args);
    activity({ ...tool, phase: 'complete' });
    trace('factory_read_completed', turn.number, owner.number);
    return turn.finished || turn !== current ? { stale: true } : { evidence };
   } catch (error) {
    const denied = error.code === 'factory_read_denied';
    activity({ turn_id: turn.id, operation: owner.number, phase: denied ? 'denied' : 'failed' });
    trace('factory_read_failed', turn.number, owner.number, denied ? 'permission_denied' : 'tool_unavailable');
    return turn.finished || turn !== current ? { stale: true } : { error: denied
     ? 'Factory access was denied by current Admin permissions. Explain this in the user’s language. Do not retry the read or invent stock.'
     : 'Current Factory stock is unavailable. Explain the failed read; do not claim successful evidence or retry automatically.' };
   } finally {
    turn.toolPending = false;
    if (!turn.finished && turn === current) state('thinking');
   }
  },
  close(reason = 'session_ended') {
   for (const turn of inputs.values()) finish(turn, 'unfinished', turn.response?.transcript, reason, turn.response);
   return writes;
  },
 };
}
