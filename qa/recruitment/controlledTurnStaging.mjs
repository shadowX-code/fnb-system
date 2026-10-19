// Real provider, synthetic-only. WebSocket output-drain/clear receipts are modeled,
// so this verifies policy/cancellation/context, never WebRTC/iOS audibility.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {OpenAIInterviewConversation} from '../../src/features/recruitment/OpenAIInterviewConversation.js';
const dir=process.env.FEEDX_TURN_QA_DIR;if(!dir)throw Error('Private synthetic fixture directory required');
const token=fs.readFileSync(`${dir}/invitation.txt`,'utf8').trim(),key=fs.readFileSync(`${dir}/public-key.txt`,'utf8').trim();
assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref,'ujkzdaaadnvcfayuldmh');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Origin:'https://fnb-system-staging.vercel.app'};
async function post(path,body){const r=await fetch('https://ujkzdaaadnvcfayuldmh.supabase.co'+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||d?.error)throw Error(`${path}: ${d?.message||d?.error||r.status}`);return d;}
const rpc=(name,args={})=>post('/rest/v1/rpc/'+name,{p_token:token,...args});
const client=crypto.randomUUID();let recovery=null,unit,ws,c,persist=Promise.resolve(),interruptNext=false;
const evidence=(action,payload={})=>post('/functions/v1/recruitment-evidence',{action,token,client_id:client,payload});
const wait=async(test,label,ms=30000)=>{const end=Date.now()+ms;while(Date.now()<end){if(test())return;await sleep(100);}throw Error(label+' timed out');};
const result={synthetic:true,physical:false,generations:[],recoveries:[]};
async function start(){
 const prior=recovery;recovery=crypto.randomUUID();unit=crypto.randomUUID();
 const attempt=await rpc('recruitment_recovery_begin',{p_client_id:client,p_request_id:recovery,p_expected_id:prior});
 await evidence('open',{unit_id:unit,mime_type:'video/mp4',recovery_id:recovery});
 const secret=await post('/functions/v1/recruitment-realtime',{token,client_id:client,recovery_id:recovery,conversation_version:'controlled-turns-v1',orientation_version:'continuity-v2'});
 assert.equal(secret.turn_policy,'controlled-turns-v1');assert.equal(secret.conversation_protocol,'continuity-v2');
 const observed={attemptStarted:attempt.started_at,generation:secret.generation,context:secret.conversation_instructions,events:[],turns:[],responses:[],accepted:[],rejected:[],errors:[]};result.generations.push(observed);
 let ready=false;const items=[],boundary=new Map(),candidate=new Map(),ai=new Map();
 ws=new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5',['realtime','openai-insecure-api-key.'+secret.value]);const active=ws;
 const saveTurn=t=>{observed.turns.push(t);persist=persist.then(()=>rpc('recruitment_public_transcript_turn',{p_client_id:client,p_generation:secret.generation,p_provider_order:items.indexOf(t.id)+1,p_item_id:t.id,p_speaker:t.speaker,p_transcript:t.text,p_start_ms:null,p_end_ms:Date.now()-Date.parse(attempt.started_at)}));};
 c=new OpenAIInterviewConversation({send:event=>{
  observed.events.push('client.'+event.type);
  if(event.type==='output_audio_buffer.clear'){observed.modeledOutputClear=true;return;}
  active.send(JSON.stringify(event));
 },candidateEligible:id=>{const b=boundary.get(id);return !!(b?.started&&b.stopped&&b.committed);},
 onInput:open=>observed.inputOpen=open,onTurnState:view=>observed.view=view,
 onAcceptCandidate:id=>{observed.accepted.push(id);saveTurn({id,speaker:'candidate',text:candidate.get(id)});},
 onRejectCandidate:id=>observed.rejected.push(id),onRecovery:reason=>result.recoveries.push(reason),onTool:()=>({can_finish:false,reason:'Continue the synthetic test conversation.'})});
 c.controlled=true;c.presentationOwned=true;c.instructions=secret.conversation_instructions;const adapter=c;
 active.addEventListener('message',({data})=>{
  if(adapter.closed)return;const e=JSON.parse(data);observed.events.push(e.type);
  if(e.type==='session.created'){ready=true;observed.providerPolicy=e.session.audio.input.turn_detection;return;}
  if(e.type==='error'){observed.errors.push(e.error?.code||'provider_error');return;}
  const id=e.item_id;
  if(e.item?.type==='message'||e.type==='input_audio_buffer.committed'){const item=e.item?.id||id;if(!items.includes(item))items.push(item);}
  if(e.type==='input_audio_buffer.speech_started')boundary.set(id,{started:observed.inputOpen});
  if(e.type==='input_audio_buffer.speech_stopped'&&boundary.has(id))boundary.get(id).stopped=true;
  if(e.type==='input_audio_buffer.committed'&&boundary.has(id))boundary.get(id).committed=true;
  if(e.type==='conversation.item.input_audio_transcription.completed')candidate.set(id,e.transcript);
  if(e.type==='response.output_audio_transcript.done')ai.set(e.response_id,{id,speaker:'ai',text:e.transcript});
  adapter.event(e);
  if(e.type==='response.created')observed.responses.push(e.response.id);
  if(e.type==='response.output_audio.delta'){
   if(!adapter.activeAudioResponse)adapter.event({type:'output_audio_buffer.started',response_id:e.response_id});
   if(interruptNext){interruptNext=false;observed.explicitInterrupt=adapter.interrupt();}
  }
  if(e.type==='response.done'){
   if(e.response.status==='completed'){
    const turn=ai.get(e.response.id);if(turn)saveTurn(turn);
    adapter.event({type:'output_audio_buffer.stopped',response_id:e.response.id});
   } else if(e.response.status==='cancelled'){
    observed.providerCancellationAcknowledged=true;
    adapter.event({type:'output_audio_buffer.cleared',response_id:e.response.id});
   }
  }
 });
 await wait(()=>ready,'Provider open');assert.equal(observed.providerPolicy.create_response,false);assert.equal(observed.providerPolicy.interrupt_response,false);
 await rpc('recruitment_recovery_connected',{p_client_id:client,p_request_id:recovery,p_generation:secret.generation});
 adapter.begin(`session:${secret.generation}`,secret.first_response_instructions);
 await wait(()=>observed.inputOpen,'Entry drain');assert.equal(observed.errors.length,0);return observed;
}
async function answer(observed){
 const pcm=fs.readFileSync(`${dir}/quiet.pcm`);assert(observed.inputOpen);
 for(let i=0;i<pcm.length;i+=9600){assert(observed.inputOpen);ws.send(JSON.stringify({type:'input_audio_buffer.append',audio:pcm.subarray(i,i+9600).toString('base64')}));await sleep(200);}
 const quiet=setInterval(()=>ws.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({type:'input_audio_buffer.append',audio:Buffer.alloc(9600).toString('base64')})),200);
 try{await wait(()=>observed.view?.canSend,'Candidate preview');}finally{clearInterval(quiet);}
 const before=observed.responses.length;await sleep(1000);assert.equal(observed.responses.length,before,'ASR must not auto-respond');assert.equal(observed.accepted.length,0);
 assert(c.confirmAnswer());assert(!c.confirmAnswer());await wait(()=>observed.responses.length===before+1&&observed.inputOpen,'One accepted response');
 assert.equal(observed.accepted.length,1);await persist;
}
try{
 let entry=await rpc('recruitment_public_entry');assert(entry.available&&entry.profile.full_name.startsWith('QA Synthetic Turn Policy Probe'));
 if(entry.status==='invited')entry=await rpc('recruitment_public_confirm_profile',{p_name:entry.profile.full_name,p_contact:entry.profile.contact});
 if(entry.status==='profile_confirmed')entry=await rpc('recruitment_public_consent',{p_copy_version:entry.copy_version,p_accepted:{ai:true,recording:true,review:true}});
 if(entry.status==='consented')await rpc('recruitment_public_ready',{p_device_check:{camera:'ready',microphone:'ready'}});
 const first=await start();await answer(first);c.close();ws.close();await persist;
 await evidence('invalid',{unit_id:unit});await rpc('recruitment_recovery_pause',{p_client_id:client,p_request_id:recovery,p_reason:'synthetic_background'});
 const second=await start();assert.equal(second.attemptStarted,first.attemptStarted);assert.equal(second.generation,first.generation+1);
 assert(/six months|6 months/i.test(second.context));assert(second.turns.some(t=>t.speaker==='ai'));assert(!second.turns.some(t=>/欢迎参加|welcome to|我是.*面试官|I am FeedX/i.test(t.text)));
 // Exercise an explicit provider cancellation separately; buffer-clear receipt is modeled for WS.
 interruptNext=true;c.awaitingResponse=true;c.setInput(false);c.acceptedOwner='synthetic-interruption';
 ws.send(JSON.stringify({type:'response.create',response:{max_output_tokens:350,metadata:{feedx_kind:'answer',owner:c.acceptedOwner},instructions:'For this synthetic cancellation probe only, explain customer service in eight calm sentences. Do not call tools.'}}));
 await wait(()=>second.providerCancellationAcknowledged&&second.inputOpen,'Explicit cancellation acknowledgement');
 assert(second.explicitInterrupt);assert.equal(result.recoveries.length,0);assert(result.generations.every(g=>!g.errors.length));
 result.passed=true;console.log('PASS',JSON.stringify({sameAttempt:true,acceptedResponses:1,replacementGeneration:second.generation,noOpeningReplay:true,explicitProviderCancel:true,physicalPlayback:false}));
}finally{
 c?.close();ws?.close();await persist.catch(()=>{});
 if(unit)await evidence('invalid',{unit_id:unit}).catch(()=>{});
 if(recovery){await rpc('recruitment_public_finish',{p_client_id:client,p_reason:'candidate_stop'}).catch(()=>{});result.terminal=await evidence('finalize').catch(e=>({error:e.message}));}
 fs.writeFileSync(`${dir}/controlled-acceptance.json`,JSON.stringify(result,null,2));
}
