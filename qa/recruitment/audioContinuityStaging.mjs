// Synthetic-only Staging provider exercise. WebSocket drain receipts are modeled;
// this cannot certify WebRTC playback, echo cancellation or physical iOS recovery.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {OpenAIInterviewConversation} from '../../src/features/recruitment/OpenAIInterviewConversation.js';
const dir=process.env.FEEDX_AUDIO_QA_DIR;if(!dir)throw Error('Private synthetic fixture directory required');
const token=fs.readFileSync(`${dir}/invitation.txt`,'utf8').trim();
const key=fs.readFileSync(`${dir}/public-key.txt`,'utf8').trim();
assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).ref,'ujkzdaaadnvcfayuldmh');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Origin:'https://fnb-system-staging.vercel.app'};
async function post(path,body){const r=await fetch('https://ujkzdaaadnvcfayuldmh.supabase.co'+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||d?.error)throw Error(`${path}: ${d?.message||d?.error||r.status}`);return d;}
const rpc=(name,args={})=>post('/rest/v1/rpc/'+name,{p_token:token,...args});
const evidence=(action,payload={})=>post('/functions/v1/recruitment-evidence',{action,token,client_id:client,payload});
const client=crypto.randomUUID();let recovery=null,unit,ws,adapter,persist=Promise.resolve();
const output={synthetic:true,physical_playback_verified:false,generations:[],recoveries:[]};
const save=()=>fs.writeFileSync(`${dir}/observations.json`,JSON.stringify(output,null,2));
const wait=async(test,label,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(test())return;await sleep(100);}throw Error(label+' timed out');};
if(process.argv.includes('--verify-observations')){
 const observed=JSON.parse(fs.readFileSync(`${dir}/observations.json`));
 assert.equal(observed.generations.length,2);assert.equal(observed.recoveries.length,0);
 const [first,second]=observed.generations;
 assert.equal(first.turns.filter(t=>t.speaker==='candidate').length,2);
 assert.equal(second.generation,first.generation+1);
 assert(/(?:six|6) months/i.test(second.context));assert(/part[- ]time/i.test(second.context));
 assert(second.turns.some(t=>t.speaker==='ai'&&/start next week/i.test(t.text)));
 assert(!second.turns.some(t=>t.speaker==='ai'&&/welcome|introduce yourself|my name is|I'm FeedX/i.test(t.text)));
 for(const generation of observed.generations)assert.equal(new Set(generation.responses.map(r=>r.id)).size,generation.responses.length);
 console.log('PASS retained real-provider observations: two automatic answers, fresh generation, durable context, no repeated opening or duplicate response IDs. Physical playback is unverified.');process.exit(0);
}
async function start(){
 const expected=recovery;recovery=crypto.randomUUID();unit=crypto.randomUUID();
 const attempt=await rpc('recruitment_recovery_begin',{p_client_id:client,p_request_id:recovery,p_expected_id:expected});
 await evidence('open',{unit_id:unit,mime_type:'video/mp4',recovery_id:recovery});
 const secret=await post('/functions/v1/recruitment-realtime',{token,client_id:client,recovery_id:recovery,conversation_version:'provider-owned-v1',orientation_version:'continuity-v2'});
 assert.equal(secret.conversation_protocol,'continuity-v2');
 const observed={generation:secret.generation,attempt_started_at:attempt.started_at,turns:[],responses:[],events:[],context:secret.conversation_instructions};output.generations.push(observed);
 const items=[];let order=0;
 ws=new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5',['realtime','openai-insecure-api-key.'+secret.value]);
 const active=ws;
 adapter=new OpenAIInterviewConversation({send:e=>active.send(JSON.stringify(e)),onTool:()=>({can_finish:false,reason:'Focused synthetic test, continue the current question.'}),onRecovery:r=>{output.recoveries.push(r);console.log('RECOVERY',r);},candidateEligible:()=>true});
 adapter.presentationOwned=true;adapter.instructions=secret.conversation_instructions;
 const current=adapter;
 active.addEventListener('message',({data})=>{
  if(current.closed)return;const e=JSON.parse(data);observed.events.push(e.type);
  if(e.type==='error'){observed.error=e.error?.code||e.error?.message;return;}
  if(e.type==='session.created')assert(!e.session.tools.some(t=>t.name==='confirm_orientation'));
  if((e.item?.type==='message'||e.type==='input_audio_buffer.committed')){const id=e.item?.id||e.item_id;if(!items.includes(id))items.push(id);}
  if(['response.output_audio_transcript.done','conversation.item.input_audio_transcription.completed'].includes(e.type)){
   const t={speaker:e.type.startsWith('response.')?'ai':'candidate',text:e.transcript,item_id:e.item_id};observed.turns.push(t);
   persist=persist.then(()=>rpc('recruitment_public_transcript_turn',{p_client_id:client,p_generation:secret.generation,p_provider_order:items.indexOf(e.item_id)+1||++order,p_item_id:e.item_id,p_speaker:t.speaker,p_transcript:t.text,p_start_ms:null,p_end_ms:Date.now()-Date.parse(attempt.started_at)}));
   console.log(t.speaker,t.text.slice(0,180));
  }
  current.event(e);
  if(e.type==='response.done'){
   observed.responses.push({id:e.response.id,status:e.response.status});
   if(e.response.status==='completed'&&e.response.output.some(i=>i.type==='message'))current.event({type:'output_audio_buffer.stopped',response_id:e.response.id});
  }
 });
 await wait(()=>observed.events.includes('session.created'),'provider connection');
 await rpc('recruitment_recovery_connected',{p_client_id:client,p_request_id:recovery,p_generation:secret.generation});
 current.begin(`session:${secret.generation}`,secret.first_response_instructions);
 await wait(()=>observed.turns.some(t=>t.speaker==='ai')||observed.error,'entry');if(observed.error)throw Error(observed.error);
 await persist;save();return observed;
}
async function say(text,observed){
 execFileSync('/usr/bin/say',['-v','Samantha','-r','160','-o',`${dir}/input.aiff`,text]);
 execFileSync('/opt/homebrew/bin/ffmpeg',['-loglevel','error','-y','-i',`${dir}/input.aiff`,'-f','s16le','-ac','1','-ar','24000',`${dir}/input.pcm`]);
 const pcm=fs.readFileSync(`${dir}/input.pcm`),candidateBefore=observed.turns.filter(t=>t.speaker==='candidate').length,aiBefore=observed.turns.filter(t=>t.speaker==='ai').length;
 for(let i=0;i<pcm.length;i+=9600){ws.send(JSON.stringify({type:'input_audio_buffer.append',audio:pcm.subarray(i,i+9600).toString('base64')}));await sleep(200);}
 const quiet=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'input_audio_buffer.append',audio:Buffer.alloc(9600).toString('base64')}));},200);
 try{await wait(()=>observed.turns.filter(t=>t.speaker==='candidate').length>candidateBefore&&observed.turns.filter(t=>t.speaker==='ai').length>aiBefore||observed.error,'automatic next answer');if(observed.error)throw Error(observed.error);}finally{clearInterval(quiet);}
 await persist;save();
}
try{
 let entry=await rpc('recruitment_public_entry');assert(entry.available);assert(entry.profile.full_name.startsWith('QA Synthetic Audio Continuity'));
 if(entry.status==='invited'){await rpc('recruitment_public_language',{p_language:'en'});entry=await rpc('recruitment_public_confirm_profile',{p_name:entry.profile.full_name,p_contact:entry.profile.contact});}
 if(entry.status==='profile_confirmed')entry=await rpc('recruitment_public_consent',{p_copy_version:entry.copy_version,p_accepted:{ai:true,recording:true,review:true}});
 if(entry.status==='consented')await rpc('recruitment_public_ready',{p_device_check:{camera:'ready',microphone:'ready'}}); // synthetic declaration only
 const first=await start();
 await say('My name is QA Tester. I worked in a cafe for six months, serving customers and taking orders.',first);
 await say('I am looking for part time work. I can work weekends and start next week.',first);
 adapter.close();ws.close();await persist;await evidence('invalid',{unit_id:unit});
 await rpc('recruitment_recovery_pause',{p_client_id:client,p_request_id:recovery,p_reason:'qa_disconnect'});
 const second=await start();
 assert(second.context.includes('six months')||second.context.includes('6 months'),'Durable previous answer missing');
 assert(/part[- ]time/i.test(second.context),'Preference answer context missing');
 // The fresh generation's entry must respond to the saved answer, without another introduction.
 assert.equal(output.recoveries.length,0);assert.equal(second.generation,first.generation+1);output.passed=true;console.log('PASS synthetic provider progression and fresh-generation context');
}finally{
 adapter?.close();ws?.close();await persist.catch(()=>{});
 if(unit)await evidence('invalid',{unit_id:unit}).catch(()=>{});
 if(recovery){await rpc('recruitment_public_finish',{p_client_id:client,p_reason:'candidate_stop'}).catch(()=>{});output.terminal=await evidence('finalize').catch(e=>({error:e.message}));}
 save();console.log('SYNTHETIC OUTCOME',JSON.stringify(output.terminal));
}
