// Focused Staging-only provider check. Synthetic audio and modeled WebRTC drain receipts, NOT physical playback certification.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {OpenAIInterviewConversation} from '../../src/features/recruitment/OpenAIInterviewConversation.js';
const dir=process.env.FEEDX_RECRUITMENT_QA_DIR;
if(!dir)throw Error('Private disposable Staging fixture directory required');
const token=fs.readFileSync(`${dir}/invitation.txt`,'utf8').trim();
const key=fs.readFileSync(process.env.FEEDX_SUPABASE_PUBLIC_KEY_PATH,'utf8').trim();
assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref,'ujkzdaaadnvcfayuldmh');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Origin:'https://fnb-system-staging.vercel.app'};
async function post(path,body){const r=await fetch('https://ujkzdaaadnvcfayuldmh.supabase.co'+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const raw=await r.text();const d=raw?JSON.parse(raw):null;if(!r.ok||d?.error)throw Error(`${path}: ${d?.message||d?.error||r.status}`);return d;}
const rpc=(name,args={})=>post('/rest/v1/rpc/'+name,{p_token:token,...args});
const client=crypto.randomUUID(),recovery=crypto.randomUUID(),unit=crypto.randomUUID();
let entry=await rpc('recruitment_public_entry');assert(entry.available);assert.equal(entry.interview_profile?.version||entry.config?.interview_profile?.version||2,2);
if(entry.status==='invited'){await rpc('recruitment_public_language',{p_language:'zh'});entry=await rpc('recruitment_public_confirm_profile',{p_name:entry.profile.full_name,p_contact:entry.profile.contact});}
if(entry.status==='profile_confirmed')entry=await rpc('recruitment_public_consent',{p_copy_version:entry.copy_version,p_accepted:{ai:true,recording:true,review:true}});
if(entry.status==='consented')await rpc('recruitment_public_ready',{p_device_check:{camera:'ready',microphone:'ready'}}); // synthetic harness declaration only
await rpc('recruitment_recovery_begin',{p_client_id:client,p_request_id:recovery,p_expected_id:null});
await post('/functions/v1/recruitment-evidence',{action:'open',token,client_id:client,payload:{unit_id:unit,mime_type:'video/mp4',recovery_id:recovery}});
const secret=await post('/functions/v1/recruitment-realtime',{token,client_id:client,recovery_id:recovery,conversation_version:'provider-owned-v1',orientation_version:'receipt-v1'});
const ws=new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5',['realtime','openai-insecure-api-key.'+secret.value]);
const events=[],turns=[],items=[],audio=[],recoveries=[];let order=0,persist=Promise.resolve(),completion=null,coverage=null,finished=false;
const started=Date.now();
const send=e=>ws.send(JSON.stringify(e));
const save=()=>fs.writeFileSync(`${dir}/provider-observations.json`,JSON.stringify({turns,coverage,completion,recoveries,eventTypes:events.map(e=>e.type),responses:events.filter(e=>e.type==='response.done').map(e=>({id:e.response.id,status:e.response.status}))},null,2));
let assessment=null,lastAssessmentAt=0;
async function assess(){
 if(assessment)return assessment;
 if(coverage&&Date.now()-lastAssessmentAt<10000)return coverage;
 assessment=(async()=>{await persist;coverage=await post('/functions/v1/recruitment-evidence',{action:'coverage',token,client_id:client,payload:{}});lastAssessmentAt=Date.now();const context=await post('/functions/v1/recruitment-realtime',{action:'context',token,client_id:client,recovery_id:recovery,generation:secret.generation,orientation_version:'receipt-v1'});fs.writeFileSync(`${dir}/outbound-context.txt`,context.instructions);adapter.updateContext(context.instructions);save();console.log('COVERAGE',JSON.stringify(coverage));return coverage;})();
 try{return await assessment;}finally{assessment=null;}
}
const adapter=new OpenAIInterviewConversation({send,onOrientation:receipt=>{persist=persist.then(()=>rpc('recruitment_public_traces',{p_client_id:client,p_records:[{key:crypto.randomUUID(),generation:secret.generation,record:{type:'output_audio_buffer.stopped',phase:'orientation_complete',...receipt,elapsed_ms:Date.now()-started}}]}));console.log('ORIENTATION CHECKPOINT',receipt.item_id);},onRecovery:r=>{recoveries.push(r);console.log('RECOVERY',r);save();},onTool:async()=>{completion=await assess();return completion;},onCompletion:()=>{finished=true;}});
adapter.orientationRequired=secret.orientation_required;adapter.introductionPending=secret.introduction_pending===true;adapter.instructions=secret.conversation_instructions;
ws.addEventListener('message',({data})=>{const e=JSON.parse(data);events.push(e);if(e.type==='session.created'){fs.writeFileSync(`${dir}/initial-outbound-context.txt`,e.session.instructions);console.log('SESSION',e.session.model,JSON.stringify(e.session.audio.input.turn_detection));}
const item=e.item?.id;if(item&&!items.includes(item))items.push(item);
if(e.type==='response.output_audio.delta')audio.push(Buffer.from(e.delta,'base64'));
if(e.type==='response.output_audio_transcript.done'||e.type==='conversation.item.input_audio_transcription.completed'){
 const t={speaker:e.type==='conversation.item.input_audio_transcription.completed'?'candidate':'ai',text:e.transcript,item_id:e.item_id,response_id:e.response_id,elapsed:Date.now()-started};turns.push(t);console.log(t.speaker.toUpperCase(),t.text);save();
 persist=persist.then(()=>rpc('recruitment_public_transcript_turn',{p_client_id:client,p_generation:secret.generation,p_provider_order:items.indexOf(t.item_id)+1||++order,p_item_id:t.item_id,p_speaker:t.speaker,p_transcript:t.text,p_start_ms:null,p_end_ms:t.elapsed})).catch(err=>{recoveries.push(err.message);throw err;});
}
adapter.event(e);
// WebSocket has no WebRTC output-buffer receipts. Model the adapter receipt
// only for this disposable synthetic conversation; physical playback is NOT certified.
if(e.type==='response.done' && e.response.status==='completed' && e.response.output?.some(i=>i.type==='message')) adapter.event({type:'output_audio_buffer.stopped',response_id:e.response.id});
if(e.type==='response.done'&&adapter.responses.get(e.response.id)?.closing&&e.response.status==='completed'){finished=true;console.log('CLOSING COMPLETE');save();}
});
const wait=async(test,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const error=events.find(e=>e.type==='error');if(error)throw Error(`${label}: ${error.error?.message}`);if(fs.existsSync(`${dir}/stop`))throw Error('Focused harness stopped');if(test())return;await sleep(100);}throw Error(`${label}: timeout`);};
let heart,silenceTimer;
try{
 await wait(()=>events.some(e=>e.type==='session.created'),'connect');await rpc('recruitment_recovery_connected',{p_client_id:client,p_request_id:recovery,p_generation:secret.generation});
 heart=setInterval(()=>rpc('recruitment_public_heartbeat',{p_client_id:client}).catch(e=>console.log('HEARTBEAT',e.message)),15000);
 await rpc('recruitment_public_traces',{p_client_id:client,p_records:[{key:crypto.randomUUID(),generation:secret.generation,record:{type:'transport.connected',phase:'orientation_pending'}}]});
 adapter.begin('qa-entry',secret.first_response_instructions);await wait(()=>events.some(e=>e.type==='response.output_audio.delta'),'entry audio');
 const hello=fs.readFileSync(`${dir}/hello.pcm`);
 for(let i=0;i<hello.length;i+=9600){send({type:'input_audio_buffer.append',audio:hello.subarray(i,i+9600).toString('base64')});await sleep(200);}
 const helloQuiet=setInterval(()=>send({type:'input_audio_buffer.append',audio:Buffer.alloc(9600).toString('base64')}),200);
 await wait(()=>turns.filter(t=>t.speaker==='candidate').length>0 && events.some(e=>e.type==='response.done'&&e.response.status==='completed'&&e.response.metadata?.feedx_kind!=='entry'),'short Hello automatic response');clearInterval(helloQuiet);await persist;
 console.log('READY FOR ANSWER');
 for(let n=1;n<=10&&!finished;n++){
  const file=`${dir}/answer-${n}.json`;await wait(()=>fs.existsSync(file)||finished,'test input',240000);if(finished)break;
  const {text,voice='Samantha'}=JSON.parse(fs.readFileSync(file));
  execFileSync('/usr/bin/say',['-v',voice,'-r','170','-o',`${dir}/answer.aiff`,text]);execFileSync('/opt/homebrew/bin/ffmpeg',['-loglevel','error','-y','-i',`${dir}/answer.aiff`,'-f','s16le','-ac','1','-ar','24000',`${dir}/answer.pcm`]);
  const pcm=fs.readFileSync(`${dir}/answer.pcm`),candidateBefore=turns.filter(t=>t.speaker==='candidate').length,aiBefore=turns.filter(t=>t.speaker==='ai').length;
  const previous=new Set(events.filter(e=>e.type==='response.created').map(e=>e.response.id));
  const silence=Buffer.alloc(9600);
  for(let i=0;i<pcm.length;i+=9600){send({type:'input_audio_buffer.append',audio:pcm.subarray(i,i+9600).toString('base64')});await sleep(200);}
  silenceTimer=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)send({type:'input_audio_buffer.append',audio:silence.toString('base64')});},200);
  await wait(()=>turns.filter(t=>t.speaker==='candidate').length>candidateBefore,'real candidate transcript');
  await wait(()=>finished||(turns.filter(t=>t.speaker==='ai').length>aiBefore&&events.some(e=>e.type==='response.done'&&e.response.status==='completed'&&!previous.has(e.response.id))),'automatic AI answer',90000);
  clearInterval(silenceTimer);silenceTimer=null;await persist;
  if(!finished)await assess();console.log('READY FOR ANSWER',n+1);save();
 }
 assert(finished,'Provider must request permitted completion');assert.equal(recoveries.length,0);
 await persist;await rpc('recruitment_public_finish',{p_client_id:client,p_reason:'coverage'});
 console.log('PASS provider V2 conversation reached server-permitted closing');
}finally{
 save();clearInterval(heart);clearInterval(silenceTimer);adapter.close();ws.close();fs.writeFileSync(`${dir}/provider-output.pcm`,Buffer.concat(audio));
 await post('/functions/v1/recruitment-evidence',{action:'invalid',token,client_id:client,payload:{unit_id:unit}}).catch(e=>console.log(e.message));
 await rpc('recruitment_public_finish',{p_client_id:client,p_reason:'candidate_stop'}).catch(()=>{});
 const final=await post('/functions/v1/recruitment-evidence',{action:'finalize',token,client_id:client,payload:{}}).catch(e=>({error:e.message}));fs.writeFileSync(`${dir}/provider-final.json`,JSON.stringify(final));console.log('FINAL synthetic no-camera evidence',JSON.stringify(final));
}
