/* FeedX Staging browser adaptation, 2026-11-03. GPL-3.0.
 * Derived from the independent pilot.js UUID/fencing and original HUD state bridge.
 * Generic text protocol only; no provider engine, credentials or network transport.
 * Complete modified source supplied under GPL-3.0 in source.zip.
 */
'use strict';
let pilotSession;try{pilotSession=sessionStorage.getItem('feedx.pilot.session');if(!pilotSession){pilotSession=crypto.randomUUID();sessionStorage.setItem('feedx.pilot.session',pilotSession);}}catch{pilotSession=crypto.randomUUID();}
let activeRequest='',captureEpoch=0;
const protocol='feedx.assistant.text.v1',hostOrigin='https://fnb-system-staging.vercel.app';
let connected=false,runtime=null;
function request(action,extra={}){parent.postMessage({protocol,action,request_id:crypto.randomUUID(),...extra},hostOrigin);}
const sessions=[{id:pilotSession,messages:[]}];
let currentSession=sessions[0];
const web=document.createElement('section');web.id='assistantWeb';
web.innerHTML=`<div class="web-core-caption"><span class="web-status-dot"></span><strong>Visual ready</strong><p>Original Jarvis Core · no active AI service</p><button type="button" id="webPause">Pause motion</button></div>
<section class="web-conversation" aria-label="AI conversation"><header><h1>Conversation</h1><button type="button" id="webNew">New</button></header>
<label class="web-history-label" for="webHistory">Conversation history <span>your Admin account</span></label><select id="webHistory"></select>
<details class="web-services"><summary>Services · 4 unavailable</summary><dl><div><dt>Language model</dt><dd>Not configured</dd></div><div><dt>Speech recognition</dt><dd>Not connected</dd></div><div><dt>Voice output</dt><dd>Not connected</dd></div><div><dt>FeedX tools</dt><dd>Not authorized</dd></div></dl></details>
<div id="webNotice" role="status">No model is connected. Requests stay in this tab; no AI answer will be generated.</div>
<ol id="webMessages" aria-label="Conversation messages" aria-live="polite"></ol>
<div id="webComposer"></div><div class="web-controls"><button type="button" id="webVoice" aria-disabled="true" title="No authorized voice service is connected">Voice unavailable</button><button type="button" id="webStop">Stop</button><button type="button" id="webRetry" hidden>Retry last question</button></div>
<p class="web-privacy">Your enabled model processes text. Audio is not retained. Business reads recheck Admin access. History: 24 hours.</p>
<footer class="web-license"><a href="source.zip" download>HUD source · GPL-3.0</a><a href="LICENSE.txt" download>License</a></footer></section>`;
document.body.appendChild(web);
const notice=$('#webNotice'),messageList=$('#webMessages'),history=$('#webHistory');
$('#webComposer').appendChild($('#form'));
input.setAttribute('aria-label','Message AI Assistant');input.placeholder='Ask FeedX…';input.maxLength=2000;
$('#mic').setAttribute('aria-label','Microphone unavailable');$('#mic').setAttribute('aria-disabled','true');$('#mic').title='No authorized speech recognition service is connected';
const submit=document.createElement('button');submit.type='button';submit.id='webSend';submit.textContent='Send';$('#form').appendChild(submit);
function showNotice(text,error=false){notice.textContent=text;notice.setAttribute('role',error?'alert':'status');notice.dataset.error=String(error);}
function renderHistory(){history.replaceChildren(...sessions.map((s,i)=>{const option=document.createElement('option');option.value=s.id;option.textContent=s.title||s.messages[0]?.text.slice(0,48)||`Conversation ${i+1}`;return option;}));history.value=currentSession.id;}
function renderMessages(){messageList.replaceChildren();if(!currentSession.messages.length){const empty=document.createElement('li');empty.className='web-empty';empty.textContent='Start with a question. Your request will appear here; responses require an authorized model connection.';messageList.appendChild(empty);}for(const message of currentSession.messages){const item=document.createElement('li');const label=document.createElement('strong');label.textContent=message.role==='assistant'?'Assistant':'You';const text=document.createElement('p');for(const part of message.text.split(/(\*\*[^*]+\*\*)/g)){if(part.startsWith('**')&&part.endsWith('**')){const bold=document.createElement('strong');bold.textContent=part.slice(2,-2);text.append(bold);}else text.append(document.createTextNode(part));}item.append(label,text);if(message.evidence?.capability==='read_factory_finished_goods'){const evidence=document.createElement('div');evidence.className='web-evidence';const link=document.createElement('a');link.href='https://fnb-system-staging.vercel.app/factory/warehouse/finished-goods';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Factory · Finished Goods ↗';const stamp=document.createElement('span');stamp.textContent=`${message.evidence.scope} · ${message.evidence.as_of} · ${message.evidence.returned}/${message.evidence.total_matching} matches${Number.isInteger(message.evidence.unknown_minimum_count)?' · '+message.evidence.unknown_minimum_count+' unknown minimums':''}`;const details=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('p');summary.textContent='Read evidence';note.textContent=message.evidence.limitations;details.append(summary,note);evidence.append(link,stamp,details);item.append(evidence);}messageList.appendChild(item);}messageList.scrollTop=messageList.scrollHeight;renderHistory();}
// Same request/session identity boundary as the pilot. No remote engine is configured.
let handle=function(text){text=text.trim();if(!text)return;if(activeRequest){showNotice('Stop the current response before sending another request.',true);return;}
 $('#webRetry').hidden=true;activeRequest=crypto.randomUUID();currentSession.messages.push({request_id:activeRequest,role:'user',text:text.slice(0,2000)});renderMessages();
 if(connected){parent.postMessage({protocol,action:'send',request_id:activeRequest,session_id:currentSession.id,text:text.slice(0,2000)},hostOrigin);showNotice('Submitting request…');}
 else{activeRequest='';setState('idle');showNotice('Language model unavailable. Your request was not sent and no AI answer was generated.',true);}
};
// Sandboxed frames deliberately disallow form submission; use explicit local actions.
function sendLocalRequest(){handle(input.value);input.value='';}
submit.onclick=sendLocalRequest;
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();sendLocalRequest();}});
$('#form').addEventListener('submit',event=>event.preventDefault());
$('#webNew').onclick=()=>{if(connected){activeRequest='';request('new');return;}activeRequest='';captureEpoch++;pilotSession=crypto.randomUUID();currentSession={id:pilotSession,messages:[]};sessions.push(currentSession);if(sessions.length>6)sessions.shift();input.value='';renderMessages();setState('idle');showNotice('New conversation. No model is connected; history stays in this tab.');input.focus();};
history.onchange=()=>{if(connected){activeRequest='';request('history',{session_id:history.value});return;}activeRequest='';captureEpoch++;currentSession=sessions.find(s=>s.id===history.value)||sessions[0];input.value='';renderMessages();setState('idle');showNotice('Conversation opened. No AI service is connected.');};
$('#mic').style.display='none';$('#webVoice').style.display='none';
$('#mic').onclick=()=>showNotice('Speech recognition unavailable. No microphone was opened. You can type your request.',true);
$('#webVoice').onclick=()=>showNotice('Voice output unavailable. The local Kokoro runtime is not a web-connected service.',true);
$('#webRetry').onclick=()=>{const last=[...currentSession.messages].reverse().find(m=>m.role==='user');if(last)handle(last.text);};
$('#webStop').onclick=()=>{if(connected)request('cancel');activeRequest='';captureEpoch++;setState('idle');showNotice('Stopped. No AI generation, recording or playback is running.');};
addEventListener('keydown',e=>{if(e.key==='Escape')$('#webStop').click();});
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');let paused=false;
function updateMotion(){window.FEEDX_VISUAL_PAUSED=paused||motionPreference.matches;$('#webPause').textContent=motionPreference.matches?'Reduced motion':paused?'Resume motion':'Pause motion';$('#webPause').disabled=motionPreference.matches;$('#webPause').setAttribute('aria-pressed',String(window.FEEDX_VISUAL_PAUSED));}
$('#webPause').onclick=()=>{paused=!paused;updateMotion();};motionPreference.addEventListener('change',updateMotion);updateMotion();
// Retain the reviewed default renderer; hide unrelated upstream sample instruments.
sysLive=true;tripLive=true;wxLive=true;SCHED=[];applySchedule([]);
$('.hud').style.display='none';$('#labels').style.display='none';$('#badge').style.display='none';
$('#demoBack').style.display='none';$('#skinPick')?.remove();
STATE_LABEL.idle='Idle';STATE_LABEL.listening='Listening';STATE_LABEL.thinking='Thinking';STATE_LABEL.speaking='Speaking';
setState('idle');wakeUI();renderMessages();document.body.dataset.serviceState='unavailable';
document.body.dataset.sessionId=pilotSession;document.body.dataset.webReady='true';
$('#webBootStatus')?.remove();

function serviceStatus(){
 const ready=!!runtime?.ready;document.body.dataset.serviceState=ready?'ready':'unavailable';
 $('.web-core-caption strong').textContent=ready?'Text ready':'Visual ready';
 $('.web-core-caption p').textContent='Original Jarvis Core · '+(ready?'authorized text service':'text service unavailable');
 const services=[ready?'Connected · '+runtime.model:'Unavailable',runtime?.stt?'Whisper · use Talk above':'Runtime unavailable',runtime?.tts?'Kokoro bm_george · use Voice replies above':'Runtime unavailable',runtime?.tools?'Factory Finished Goods · read only':'Unavailable'];
 $('.web-services summary').textContent='Services · '+services.filter(x=>!x.includes('unavailable')&&x!=='Unavailable').length+' connected';
 document.querySelectorAll('.web-services dd').forEach((el,i)=>el.textContent=services[i]);
}
addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==hostOrigin||event.data?.protocol!==protocol)return;
 const d=event.data;
 if(d.type==='host-ready'){request('ready');return;}
 if(d.type==='reset'){$('#webRetry').hidden=true;activeRequest='';sessions.splice(0,sessions.length,{id:crypto.randomUUID(),messages:[]});currentSession=sessions[0];input.value='';runtime=null;connected=false;setState('idle');renderMessages();serviceStatus();return;}
 if(d.type==='bootstrap'||d.type==='sessions'){
  connected=true;if(d.runtime)runtime=d.runtime;
  sessions.splice(0,sessions.length,...d.sessions.map(x=>({...x,messages:[]})));currentSession=sessions.find(x=>x.id===d.session_id)||sessions[0];
  if(!currentSession)return;renderMessages();serviceStatus();showNotice(runtime?.ready?'Conversation ready. Expand Services to see authorized capabilities.':'Text service unavailable. Check Native Assistant in AI Integrations.');return;
 }
 if(d.type==='history'){
  const selected=sessions.find(x=>x.id===d.session_id);if(!selected)return;currentSession=selected;activeRequest='';
  currentSession.messages=d.turns.flatMap(t=>[{role:'user',text:t.prompt,request_id:t.request_id},...(t.state==='completed'&&t.reply?[{role:'assistant',text:t.reply,request_id:t.request_id,evidence:t.evidence}]:[])]);
  $('#webRetry').hidden=true;renderMessages();setState('idle');return;
 }
 if(d.type==='resume'){activeRequest=d.request_id;showNotice('Recovering the active request…');return;}
 if(d.type==='cancelled'){$('#webRetry').hidden=!currentSession.messages.some(m=>m.role==='user');activeRequest='';setState('idle');showNotice('Response stopped. Late replies will not be displayed.');return;}
 if(d.type==='error'){
  if(d.request_id&&activeRequest&&d.request_id!==activeRequest)return;
  $('#webRetry').hidden=!currentSession.messages.some(m=>m.role==='user');activeRequest='';setState('error');showNotice(d.message||'Assistant unavailable.',true);return;
 }
 if(d.type==='transcript'&&typeof d.text==='string'){handle(d.text.slice(0,2000));return;}
 if(d.type==='voice_error'){showNotice(d.message||'Voice service unavailable.',true);return;}
 if(d.type==='voice_level'){window.FEEDX_AUDIO_LEVEL=Math.max(0,Math.min(1,Number(d.level)||0));return;}
 if(d.type==='voice_state'){const states={listening:'listening',transcribing:'thinking',executing:'executing',speaking:'speaking',error:'error'};window.FEEDX_AUDIO_LEVEL=0;if(states[d.state])setState(states[d.state]);else if(!activeRequest)setState('idle');return;}
 if(d.request_id!==activeRequest)return;
 if(d.type==='state'&&d.state==='executing'){setState('executing');showNotice('Reading authorized Factory Finished Goods…');}
 if(d.type==='state'&&d.state==='thinking'){setState('thinking');showNotice('Thinking…');}
 if(d.type==='result'&&typeof d.reply==='string'){
  currentSession.messages.push({role:'assistant',text:d.reply.slice(0,3000),request_id:activeRequest,evidence:d.evidence});activeRequest='';renderMessages();setState('idle');showNotice(d.evidence?'Response received · verified read evidence attached.':'Response received.');
 }
});
// The renderer is unchanged; error is a non-speaking, idle-shaped visual state.
STATES.executing=STATES.thinking;STATE_LABEL.executing='Executing · read only';
STATES.error=STATES.idle;STATE_LABEL.error='Error';
if(parent!==window)request('ready');

// 2026-11-04: resize clears WebGL buffers; repaint the frozen scene without advancing time.
addEventListener('resize',()=>{if(window.FEEDX_VISUAL_PAUSED&&!document.hidden)requestAnimationFrame(()=>composer.render());});
