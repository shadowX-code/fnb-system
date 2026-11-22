const toolFailureReasons = {
 business_read_denied: 'Current user permissions or scope deny this read.',
 factory_read_denied: 'Current user permissions or scope deny this read.',
 capability_disconnected: 'AI access for this capability is disabled.',
 tool_arguments_invalid: 'The arguments do not match the registered query schema.',
 tool_not_allowed: 'The requested operation is not registered for Assistant use.',
 action_not_authorized: 'The action is outside current AI or human authority.',
 business_read_unavailable: 'The authorized data source could not return a result.',
 business_result_limit: 'The result exceeds the bounded read. A narrower query is needed.',
 inventory_unavailable: 'The authorized inventory source could not return a result.',
 inventory_scope_changed: 'Inventory scope changed during the read.',
 inventory_result_limit: 'The catalogue exceeds the bounded read.',
 inventory_detail_ambiguous: 'More than one authorized record matched this exact SKU.',
 asset_outlet_required: 'Asset Tracking needs the outlet name or code.',
 asset_outlet_unresolved: 'The outlet name or code did not identify one outlet in your authorized scope.',
 entity_unresolved: 'No exact match was found in the authorized scope.',
 entity_ambiguous: 'Please confirm the exact name or code. A similar name cannot confirm the identity.',
 entity_scope_required: 'Please specify the exact name or code before retrying.',
 knowledge_scope_required: 'This knowledge source needs the named outlet, Brand or Legal Entity.',
 knowledge_scope_unresolved: 'The requested scope could not be identified uniquely within your current authorized sources.',
 voice_request_limit: 'This voice session reached its tool-call limit.',
 voice_session_expired: 'This voice session expired or was revoked. Start a new session.',
 realtime_not_authorized: 'Voice access is no longer available.',
 authentication_required: 'Sign in again before querying.',
 provider_timeout: 'The request timed out.',
};

function attemptedOperation(tool, args) {
 const operation = tool === 'run_business_query' ? args?.operation : tool;
 return typeof operation === 'string' && /^[a-z][a-z0-9_]{0,99}$/.test(operation) ? operation : undefined;
}

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
  async tool(args, responseId, operation) {
   const owner = responses.get(responseId);
   const turn = owner?.turn;
   const ownsTurn = () => turn && turn === current && turn.response === owner && !turn.finished;
   if (!ownsTurn() || turn.toolPending || owner.tool) return { stale: true };
   owner.tool = true;
   turn.toolPending = true;
   state('executing');
   const attempted = attemptedOperation(operation, args);
   const tool = { turn_id: turn.id, operation: owner.number, capability: attempted };
   trace('business_tool_started', turn.number, owner.number, attempted);
   try {
    await turn.started;
    await writes;
    if (!ownsTurn()) return { stale: true };
    activity({ ...tool, phase: 'executing' });
    const result = await read(turn.id, args, operation);
    if (!ownsTurn()) return { stale: true };
    activity({ ...tool, label: result.operation_label, phase: result.error || result.no_evidence ? 'failed' : 'complete' });
    trace('business_tool_finished', turn.number, owner.number, result.error || (result.discovery_only ? 'discovery' : 'returned'));
    return { result };
   } catch (error) {
    if (!ownsTurn()) return { stale: true };
    const code = Object.hasOwn(toolFailureReasons, error.code) ? error.code : 'assistant_unavailable';
    const capability = error.diagnostic?.operation || attempted;
    const label = error.diagnostic?.operation_label;
    const denied = ['business_read_denied','factory_read_denied','capability_disconnected','action_not_authorized'].includes(code);
    activity({ ...tool, capability, label, phase: denied ? 'denied' : 'failed' });
    trace('business_tool_failed', turn.number, owner.number, code);
    const reason = error.diagnostic?.stage === 'evidence'
     ? 'The operation result could not be saved to this conversation.'
     : toolFailureReasons[code] || 'The tool request did not finish successfully.';
    const instruction=code==='tool_not_allowed'&&operation==='run_business_query'
     ? 'Discover the intended domain with find_business_queries and use a returned operation ID and schema. No business read occurred.'
     : 'Briefly explain the actual failure in the user’s language. Do not switch domains, invent evidence, or retry automatically.';
    return { result: { error: code, operation: capability, operation_label: label, reason,
     query_outcome:error.diagnostic?.query_outcome||'EXECUTION_ERROR',no_evidence: true, instruction } };
   } finally {
    turn.toolPending = false;
    if (ownsTurn()) state('thinking');
   }
  },
  close(reason = 'session_ended') {
   for (const turn of inputs.values()) finish(turn, 'unfinished', turn.response?.transcript, reason, turn.response);
   return writes;
  },
 };
}
