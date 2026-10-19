// Limited synthetic provider comparison, not WebRTC or physical iOS certification.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
const dir=process.env.FEEDX_TURN_QA_DIR;if(!dir)throw Error('Private synthetic fixture directory required');
const token=fs.readFileSync(`${dir}/invitation.txt`,'utf8').trim(),key=fs.readFileSync(`${dir}/public-key.txt`,'utf8').trim();
assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref,'ujkzdaaadnvcfayuldmh');
const client=crypto.randomUUID(),recovery=crypto.randomUUID(),unit=crypto.randomUUID();
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Origin:'https://fnb-system-staging.vercel.app'};
async function post(path,body){const r=await fetch('https://ujkzdaaadnvcfayuldmh.supabase.co'+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||d?.error)throw Error(`${path}: ${d?.message||d?.error||r.status}`);return d;}
const rpc=(name,args={})=>post('/rest/v1/rpc/'+name,{p_token:token,...args});
const evidence=(action,payload={})=>post('/functions/v1/recruitment-evidence',{action,token,client_id:client,payload});
const wait=async(test,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(test())return true;await sleep(100);}return false;};
const result={synthetic:true,physical:false,trials:[]};let socket,begun=false,trial;
const send=e=>socket.send(JSON.stringify(e));
function pcmNoise(){let seed=17,filtered=0;const b=Buffer.alloc(24000*2*2);for(let n=0;n<b.length/2;n++){seed=(seed*1664525+1013904223)>>>0;filtered=filtered*.6+((seed/4294967296)*2-1)*.4;const envelope=Math.sin(Math.PI*(n%16000)/16000)**2;b.writeInt16LE(Math.round(filtered*envelope*18000),n*2);}return b;}
async function input(pcm){for(let i=0;i<pcm.length;i+=9600){send({type:'input_audio_buffer.append',audio:pcm.subarray(i,i+9600).toString('base64')});await sleep(200);}for(let i=0;i<45;i++){send({type:'input_audio_buffer.append',audio:Buffer.alloc(9600).toString('base64')});await sleep(200);}}
try {
 let entry=await rpc('recruitment_public_entry');assert(entry.available&&entry.profile.full_name.startsWith('QA Synthetic Turn Policy Probe'));
 if(entry.status==='invited')entry=await rpc('recruitment_public_confirm_profile',{p_name:entry.profile.full_name,p_contact:entry.profile.contact});
 if(entry.status==='profile_confirmed')entry=await rpc('recruitment_public_consent',{p_copy_version:entry.copy_version,p_accepted:{ai:true,recording:true,review:true}});
 if(entry.status==='consented')await rpc('recruitment_public_ready',{p_device_check:{camera:'ready',microphone:'ready'}});
 await rpc('recruitment_recovery_begin',{p_client_id:client,p_request_id:recovery,p_expected_id:null});begun=true;
 await evidence('open',{unit_id:unit,mime_type:'video/mp4',recovery_id:recovery});
 const secret=await post('/functions/v1/recruitment-realtime',{token,client_id:client,recovery_id:recovery,conversation_version:'provider-owned-v1',orientation_version:'continuity-v2'});
 socket=new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5',['realtime','openai-insecure-api-key.'+secret.value]);
 let ready=false,updated=0;
 socket.addEventListener('message',({data})=>{const e=JSON.parse(data);if(e.type==='session.created')ready=true;if(e.type==='session.updated')updated++;if(!trial)return;
  if(e.type==='error'){trial.errors.push(e.error?.code||'provider_error');return;}
  trial.events.push({type:e.type,status:e.response?.status,item:e.item_id,response:e.response_id||e.response?.id});
  if(e.type==='conversation.item.input_audio_transcription.completed')trial.transcripts.push({id:e.item_id,text:e.transcript});
  if(e.type==='response.created')trial.responses.push(e.response.id);
  if(e.type==='response.done')trial.done.push({id:e.response.id,status:e.response.status});
  if(e.type==='response.output_audio.delta'&&!trial.noiseStarted){trial.noiseStarted=true;trial.noisePromise=input(pcmNoise());}
 });
 assert(await wait(()=>ready),'Provider did not open');
 await rpc('recruitment_recovery_connected',{p_client_id:client,p_request_id:recovery,p_generation:secret.generation});
 execFileSync('/usr/bin/say',['-v','Samantha','-r','145','-o',`${dir}/quiet.aiff`,'I worked in a cafe for six months. I helped customers and served food.']);
 execFileSync('/opt/homebrew/bin/ffmpeg',['-loglevel','error','-y','-i',`${dir}/quiet.aiff`,'-af','volume=0.12','-f','s16le','-ac','1','-ar','24000',`${dir}/quiet.pcm`]);
 for(const [name,vad] of [
  ['semantic_auto',{type:'semantic_vad',eagerness:'low',create_response:true,interrupt_response:true}],
  ['server_tuned',{type:'server_vad',threshold:0.85,silence_duration_ms:1200,prefix_padding_ms:300,create_response:true,interrupt_response:true}],
  ['controlled',{type:'semantic_vad',eagerness:'low',create_response:false,interrupt_response:false}]
 ]) {
  trial={name,vad,events:[],responses:[],done:[],transcripts:[],errors:[],noiseStarted:false};result.trials.push(trial);
  const before=updated;send({type:'session.update',session:{type:'realtime',audio:{input:{turn_detection:vad}}}});assert(await wait(()=>updated>before),'Session update missing');
  send({type:'input_audio_buffer.clear'});
  send({type:'response.create',response:{max_output_tokens:350,instructions:'For this synthetic audio reliability probe only, read a calm professional interview opening of around eight sentences about customer service, teamwork and availability. Do not call tools.'}});
  assert(await wait(()=>trial.noiseStarted),'No provider audio');await trial.noisePromise;
  await wait(()=>trial.done.length===trial.responses.length);trial.noiseResults={vadStarts:trial.events.filter(e=>e.type==='input_audio_buffer.speech_started').length,responses:trial.responses.length,cancelled:trial.done.filter(d=>d.status==='cancelled').length,transcripts:[...trial.transcripts]};
  send({type:'input_audio_buffer.clear'});for(const t of trial.transcripts)send({type:'conversation.item.delete',item_id:t.id});
  const transcriptCount=trial.transcripts.length,responseCount=trial.responses.length;
  await input(fs.readFileSync(`${dir}/quiet.pcm`));await wait(()=>trial.transcripts.length>transcriptCount,4000);
  trial.quietResult={recognized:trial.transcripts.slice(transcriptCount),automaticResponses:trial.responses.length-responseCount};
  if(name==='controlled'&&trial.quietResult.recognized.length){
   assert.equal(trial.quietResult.automaticResponses,0);
   send({type:'response.create',response:{max_output_tokens:100,instructions:'Acknowledge the synthetic cafe experience briefly and ask one relevant follow-up. Do not call tools.'}});
   assert(await wait(()=>trial.responses.length>responseCount),'Controlled accepted answer had no response');await wait(()=>trial.done.length===trial.responses.length);
   trial.acceptedResponses=trial.responses.length-responseCount;
  }
  console.log(name,JSON.stringify({noise:trial.noiseResults,quiet:trial.quietResult,acceptedResponses:trial.acceptedResponses,errors:trial.errors}));
  delete trial.noisePromise;
 }
}finally{
 socket?.close();trial=null;
 if(begun){await evidence('invalid',{unit_id:unit}).catch(()=>{});await rpc('recruitment_public_finish',{p_client_id:client,p_reason:'candidate_stop'}).catch(()=>{});result.terminal=await evidence('finalize').catch(e=>({error:e.message}));}
 fs.writeFileSync(`${dir}/provider-comparison.json`,JSON.stringify(result,null,2));
}
