const reasons = new Set(['turn_detected', 'client_cancelled', 'max_output_tokens', 'content_filter']);

// The trace is call-local. Local ordinals correlate events without exposing provider IDs or content.
export function createRealtimeLifecycle({ record, send, preview, state, trace, readTool, isCurrent, provider, canHear = () => true }) {
 const turns = new Map(), responses = new Map(), calls = new Set();
 let current, activeResponse, handoff, sequence = 0, responseSequence = 0, speaking = false;
 const log = (event, response, reason) => trace(event, response?.turn.number ?? current?.number, response?.number, reason);
 function finish(turn, step, text = '') {
  if (!turn || turn.finished) return;
  turn.finished = true;
  log('persist_'+step, turn.response);
  record(turn, step, text);
 }
 function complete(response) {
  if (!response?.done || !response.drained || response.cleared || response.turn.finished) return;
  finish(response.turn, response.transcript ? 'complete' : 'unavailable', response.transcript);
 }
 function discardHandoff(reason) {
  if (!handoff) return;
  clearTimeout(handoff.timeout);
  log('tool_continuation_discarded',handoff.response,reason);
  handoff = null;
 }
 async function tool(response, item) {
  if (typeof item.call_id !== 'string' || calls.has(item.call_id) || response.turn.finished) return;
  calls.add(item.call_id);
  const task = {response,callId:item.call_id};
  handoff=task;
  log('tool_read_started',response);
  state('executing');
  let result;
  try {
   result = await readTool(response.turn, JSON.parse(item.arguments));
  } catch {
   result = {error:'Current Finished Goods evidence unavailable. Do not infer stock.'};
  }
  if (!isCurrent() || handoff !== task || response.turn !== current || current.finished) return;
  log('tool_read_finished',response,result.error?'read_failed':'read_returned');
  task.itemId = 'item_'+crypto.randomUUID().replaceAll('-','');
  const accepted=send({type:'conversation.item.create',event_id:task.itemId,item:{
   id:task.itemId,type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result),
  }});
  if(!accepted){
   discardHandoff('transport_unavailable');finish(response.turn,'failed');state('error');return;
  }
  log('tool_output_sent',response);
  task.timeout=setTimeout(()=>{
   if(handoff!==task)return;
   discardHandoff('tool_ack_timeout');finish(response.turn,'failed');state('error');
  },5000);
 }
 function commit(event) {
  if(typeof event.item_id!=='string'||turns.has(event.item_id))return;
  if(current&&!current.finished){
   complete(current.response);
   if(!current.finished){
    const old=current.response;
    discardHandoff('next_user_commit');
    finish(current,old?.cleared?'interrupted':'unfinished');
   }
  }
  current={id:crypto.randomUUID(),number:++sequence};
  turns.set(event.item_id,current);
  log('speech_commit');
  record(current,'start');
  state('thinking');
 }
 function receive(event) {
  switch(event.type){
   case 'input_audio_buffer.speech_started':
    log('speech_started',activeResponse,speaking?'during_playback':'no_playback');
    // This is a detector signal, not proof of cancellation or intentional speech.
    return;
   case 'input_audio_buffer.committed':
    commit(event);
    return;
   case 'input_audio_buffer.speech_stopped':
    if(provider==='grok')commit(event);
    return;
   case 'conversation.item.input_audio_transcription.delta':
   case 'conversation.item.input_audio_transcription.updated': {
    const turn=turns.get(event.item_id);
    if(!turn||turn!==current)return;
    turn.preview=(event.transcript||((turn.preview||'')+(event.delta||''))).slice(0,2000);
    preview(turn.preview);
    return;
   }
   case 'conversation.item.input_audio_transcription.completed': {
    const turn=turns.get(event.item_id);
    if(turn&&typeof event.transcript==='string'&&event.transcript.trim()){
     log('input_transcript_final',turn.response);
     record(turn,'input',event.transcript.slice(0,2000));
    }
    if(turn===current)preview('');
    return;
   }
   case 'conversation.item.input_audio_transcription.failed':
    log('input_transcript_unavailable');
    return;
   case 'conversation.item.added':
   case 'conversation.item.created': {
    const task=handoff;
    if(!task?.itemId||event.item?.type!=='function_call_output'||event.item.call_id!==task.callId||task.response.turn!==current||current.finished||task.sent)return;
    clearTimeout(task.timeout);
    task.sent=true;
    task.eventId='evt_'+crypto.randomUUID().replaceAll('-','');
    log('tool_output_ack',task.response);
    const response=provider==='openai'?{response:{metadata:{feedx_turn:current.id}}}:{};
    if(!send({type:'response.create',event_id:task.eventId,...response})){
     discardHandoff('transport_unavailable');finish(current,'failed');state('error');return;
    }
    log('tool_response_requested',task.response);
    task.timeout=setTimeout(()=>{
     if(handoff!==task)return;
     discardHandoff('response_create_timeout');finish(current,'failed');state('error');
    },5000);
    state('thinking');
    return;
   }
   case 'response.created': {
    const id=event.response?.id;
    const tagged=event.response?.metadata?.feedx_turn;
    if(!id||responses.has(id)||!current||current.finished||(tagged&&tagged!==current.id))return;
    if(handoff&&(!handoff.sent||handoff.response.turn!==current||(provider==='openai'&&!tagged)))return;
    const continuing=!!handoff;
    if(current.response&&!continuing)return;
    if(handoff)clearTimeout(handoff.timeout);
    handoff=null;
    const response={turn:current,number:++responseSequence};
    current.response=response;
    activeResponse=response;
    responses.set(id,response);
    log('response_created',response,continuing?'tool_continuation':'user_turn');
    return;
   }
   case 'error':
    if(handoff&&(event.error?.event_id===handoff.itemId||event.error?.event_id===handoff.eventId)){
     const turn=handoff.response.turn;
     discardHandoff('provider_rejected_tool_continuation');finish(turn,'failed');state('error');
    }else log('provider_error',activeResponse);
    return;
  }
  const response=responses.get(event.response_id||event.response?.id);
  if(!response||response.turn.finished||response.turn.response!==response){
   if(event.type==='response.done'||event.type.startsWith('output_audio_buffer.'))log('stale_event_ignored',response);
   return;
  }
  switch(event.type){
   case 'response.function_call_arguments.done':
    if(event.name==='read_factory_finished_goods')response.tool=event;
    break;
   case 'response.output_audio_transcript.delta':
    if(response.turn===current&&typeof event.delta==='string'){
     response.preview=((response.preview||'')+event.delta).slice(0,3000);
     preview(response.preview,true);
    }
    break;
   case 'response.output_audio_transcript.done':
    if(typeof event.transcript==='string')response.transcript=event.transcript.slice(0,3000);
    break;
   case 'output_audio_buffer.started':
    response.audioStarted=true;
    log('audio_started',response);
    speaking=canHear();
    if(speaking)state('speaking');
    break;
   case 'output_audio_buffer.stopped':
    response.drained=true;speaking=false;log('audio_drained',response);
    if(canHear())complete(response);else finish(response.turn,'unfinished');
    if(response.turn===current&&!handoff){preview('');state('listening');}
    break;
   case 'output_audio_buffer.cleared':
    response.cleared=true;speaking=false;log('audio_cleared',response,'provider_buffer_clear');
    if(response.audioStarted){finish(response.turn,'interrupted');preview('');state('interrupted');}
    break;
   case 'response.done': {
    const status=event.response.status;
    const reason=event.response.status_details?.reason;
    log('response_done',response,reasons.has(reason)?reason:['completed','cancelled','failed','incomplete'].includes(status)?status:'unknown');
    if(status==='cancelled'){speaking=false;finish(response.turn,'interrupted');preview('');state('interrupted');break;}
    if(status!=='completed'){finish(response.turn,status==='failed'?'failed':'unfinished');preview('');state('listening');break;}
    const output=event.response.output||[];
    const request=output.find(item=>item.type==='function_call'&&item.name==='read_factory_finished_goods')||response.tool;
    if(request){void tool(response,request);break;}
    const audio=output.flatMap(item=>item.content||[]).find(part=>['audio','output_audio'].includes(part.type));
    if(!audio&&!response.transcript){finish(response.turn,'unavailable');state('listening');break;}
    response.done=true;
    if(!response.transcript&&typeof audio?.transcript==='string')response.transcript=audio.transcript.slice(0,3000);
    complete(response);
    break;
   }
  }
 }
 return {
  receive,
  getTurnCount:()=>sequence,
  get playing(){return speaking;},
  grokAudio(event){
   const response=responses.get(event.response_id);
   if(!response||response.turn!==current||response.turn.finished)return;
   response.drained=false;
   if(!speaking){log('audio_started',response);
    speaking=canHear();
    if(speaking)state('speaking');}
   return ()=>receive({type:'output_audio_buffer.stopped',response_id:event.response_id});
  },
  close(reason){
   discardHandoff(reason);
   log('session_closed',activeResponse,reason);
   complete(current?.response);
   if(current&&!current.finished)finish(current,'unfinished');
  },
 };
}
