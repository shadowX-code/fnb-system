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
function messagesForTurn(t){
 const status={voice_interrupted:'Response interrupted',voice_transcript_unavailable:'Assistant transcript unavailable',voice_unfinished:'Response unfinished',voice_failed:'Response failed'};
 return [{role:'user',text:t.prompt,request_id:t.request_id,voice:t.voice},...(t.state==='completed'&&t.reply?
 [{role:'assistant',text:t.reply,request_id:t.request_id,evidence:t.evidence,voice:t.voice}]:
 t.voice&&status[t.error_code]?[{role:'assistant',text:status[t.error_code],outcome:t.error_code,request_id:t.request_id,voice:true,evidence:t.evidence}]:[])];
}

const web=document.createElement('section');web.id='assistantWeb';
web.innerHTML=`<div class="web-core-caption"><span class="web-status-dot"></span><strong>Visual ready</strong><p>Original Jarvis Core · no active AI service</p><button type="button" id="webPause">Pause motion</button></div>
<div class="web-reticle" aria-hidden="true"><i></i><b></b></div>
<div class="web-core-name" aria-hidden="true">J A R V I S<small>FeedX AI Core</small></div>
<aside class="web-telemetry" aria-label="Session telemetry">
<section class="web-hud-panel"><h2>Agent activity</h2><ol id="webActivity"><li class="web-activity-idle">Waiting for a request</li></ol></section>
<section class="web-hud-panel"><h2>Current session</h2><div class="web-session-body"><div class="web-session-ring"><strong id="webTurnCount">0</strong><span>Turns</span></div><dl id="webSessionFacts"></dl></div></section>
<section class="web-hud-panel"><h2>Voice state</h2><div class="web-voice-state"><p id="webLiveState">Idle</p><span class="web-signal" aria-hidden="true"></span></div></section>
</aside>
<section class="web-conversation" aria-label="AI conversation"><section class="web-operations" aria-label="Operations intelligence"><h2>Operations intelligence</h2><div id="webOperations"></div></section><header><h1>Conversation</h1><button type="button" id="webNew">New</button></header>
<label class="web-history-label" for="webHistory">Conversation history <span>your Admin account</span></label><select id="webHistory"></select>
<details class="web-services"><summary>Services · 4 unavailable</summary><dl><div><dt>Language model</dt><dd>Not configured</dd></div><div><dt>Speech recognition</dt><dd>Not connected</dd></div><div><dt>Voice output</dt><dd>Not connected</dd></div><div><dt>FeedX tools</dt><dd>Not authorized</dd></div></dl></details>
<div id="webNotice" role="status">No model is connected. Requests stay in this tab; no AI answer will be generated.</div>
<p id="webVoicePreview" class="web-privacy" hidden></p>
<ol id="webMessages" aria-label="Conversation messages" aria-live="polite"></ol>
<div id="webComposer"></div><div class="web-controls"><button type="button" id="webVoice" aria-disabled="true" title="No authorized voice service is connected">Voice unavailable</button><button type="button" id="webStop">Stop</button><button type="button" id="webRetry" hidden>Retry last question</button></div>
<p class="web-privacy">Your enabled model processes text. Audio is not retained. Business reads recheck Admin access. History: 24 hours.</p>
<footer class="web-license"><a href="source.zip" download>HUD source · GPL-3.0</a><a href="LICENSE.txt" download>License</a></footer></section><div class="web-dock" aria-label="Conversation controls"></div>`;
document.body.appendChild(web);
const notice=$('#webNotice'),messageList=$('#webMessages'),history=$('#webHistory');
$('#webComposer').appendChild($('#form'));
input.setAttribute('aria-label','Message AI Assistant');input.placeholder='Ask FeedX…';input.maxLength=2000;
$('#mic').setAttribute('aria-label','Microphone unavailable');$('#mic').setAttribute('aria-disabled','true');$('#mic').title='No authorized speech recognition service is connected';
const submit=document.createElement('button');submit.type='button';submit.id='webSend';submit.textContent='Send';$('#form').appendChild(submit);
function showNotice(text,error=false){notice.textContent=text;notice.setAttribute('role',error?'alert':'status');notice.dataset.error=String(error);}
function renderHistory(){history.replaceChildren(...sessions.map((s,i)=>{const option=document.createElement('option');option.value=s.id;option.textContent=s.title||s.messages[0]?.text.slice(0,48)||`Conversation ${i+1}`;return option;}));history.value=currentSession.id;}
function renderIntelligence(){
 const messages=currentSession.messages;
 const reads=messages.filter(m=>m.evidence?.capability==='read_factory_finished_goods');
 const evidence=reads.at(-1)?.evidence;
 const facts=$('#webSessionFacts');
 facts.replaceChildren();
 $('#webTurnCount').textContent=messages.filter(m=>m.role==='user').length;
 for(const [label,value] of [['Factory evidence',reads.length],['Completed replies',messages.filter(m=>m.role==='assistant'&&!m.outcome).length]]){
  const name=document.createElement('dt'), count=document.createElement('dd');
  name.textContent=label;count.textContent=value;facts.append(name,count);
 }
 const operations=$('#webOperations');
 operations.replaceChildren();
 if(!evidence){operations.textContent='Factory insights appear after an authorized read.';return;}
 const metrics=document.createElement('dl');
 const values=[
  ['Below minimum',evidence.availability==='low'?evidence.total_matching:null],
  ['Unknown minimum',evidence.unknown_minimum_count],
 ];
 for(const [label,value] of values){
  if(!Number.isInteger(value))continue;
  const tile=document.createElement('div'),name=document.createElement('dt'),count=document.createElement('dd');
  name.textContent=label;count.textContent=value;tile.append(name,count);metrics.append(tile);
 }
 const link=document.createElement('a');
 link.href=hostOrigin+'/factory/warehouse/finished-goods';link.target='_blank';link.rel='noopener noreferrer';
 link.textContent='Factory · Finished Goods ↗';
 const scope=document.createElement('p');
 scope.textContent=[evidence.scope,evidence.query?'Filter: '+evidence.query:'',evidence.as_of?new Date(evidence.as_of).toLocaleString():''].filter(Boolean).join(' · ');
 operations.append(metrics,link,scope);
}
const activityStyles={
 'Understanding':['processing','∿','Request accepted'],
 'Processing':['processing','◌','Preparing a response'],
 'Querying Factory':['factory','◇','Reading Finished Goods'],
 'Factory evidence saved':['factory','◇','Authorized Finished Goods read'],
 'Completed':['complete','✓','Reply available in Conversation'],
 'Interrupted':['error','Ⅱ','Response interrupted'],
 'Error':['error','!','See Conversation for details'],
};
function activity(label){
 const list=$('#webActivity'),style=activityStyles[label];
 if(!style||list.lastElementChild?.dataset.label===label)return;
 if(list.firstElementChild?.classList.contains('web-activity-idle'))list.replaceChildren();
 const [stage,icon,detail]=style;
 const item=document.createElement('li');
 item.dataset.stage=stage;item.dataset.label=label;
 const marker=document.createElement('span'),copy=document.createElement('span'),caption=document.createElement('small');
 marker.className='web-event-node';marker.setAttribute('aria-hidden','true');marker.textContent=icon;
 copy.textContent=label;caption.textContent=detail;copy.append(caption);item.append(marker,copy);list.append(item);
 if(list.children.length>4)list.firstElementChild.remove();
}
function restoreActivity(turns){
 const list=$('#webActivity');list.replaceChildren();
 for(const turn of turns){
  if(turn.evidence?.capability==='read_factory_finished_goods')activity('Factory evidence saved');
  if(turn.state==='completed'&&turn.reply)activity('Completed');
  if(turn.error_code==='voice_interrupted')activity('Interrupted');
  if(turn.state==='failed')activity('Error');
 }
 if(!list.children.length){
  const idle=document.createElement('li');idle.className='web-activity-idle';idle.textContent='Waiting for a request';list.append(idle);
 }
}
function renderMessages(){renderIntelligence();$('#webStop').hidden=!activeRequest;messageList.replaceChildren();if(!currentSession.messages.length){const empty=document.createElement('li');empty.className='web-empty';empty.textContent='Start with a question. Your request will appear here; responses require an authorized model connection.';messageList.appendChild(empty);}for(const message of currentSession.messages){const item=document.createElement('li');item.dataset.speaker=message.role;const label=document.createElement('strong');label.textContent=(message.role==='assistant'?'Assistant':'You')+(message.voice?' · Voice':'');const text=document.createElement('p');for(const part of message.text.split(/(\*\*[^*]+\*\*)/g)){if(part.startsWith('**')&&part.endsWith('**')){const bold=document.createElement('strong');bold.textContent=part.slice(2,-2);text.append(bold);}else text.append(document.createTextNode(part));}item.append(label,text);if(message.evidence?.capability==='read_factory_finished_goods'){const evidence=document.createElement('div');evidence.className='web-evidence';const link=document.createElement('a');link.href='https://fnb-system-staging.vercel.app/factory/warehouse/finished-goods';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Factory · Finished Goods ↗';const stamp=document.createElement('span');stamp.textContent=`${message.evidence.scope} · ${message.evidence.as_of} · ${message.evidence.returned}/${message.evidence.total_matching} matches${Number.isInteger(message.evidence.unknown_minimum_count)?' · '+message.evidence.unknown_minimum_count+' unknown minimums':''}`;const details=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('p');summary.textContent='Read evidence';note.textContent=message.evidence.limitations;details.append(summary,note);evidence.append(link,stamp,details);item.append(evidence);}messageList.appendChild(item);}messageList.scrollTop=messageList.scrollHeight;renderHistory();}
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
$('#webVoice').onclick=()=>showNotice('Voice output unavailable. Use the voice control above the conversation.',true);
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
 const services=[ready?'Connected · '+runtime.model:'Unavailable',runtime?.voice_provider||'Unavailable',runtime?.voice_provider||'Unavailable',runtime?.tools?'Factory Finished Goods · read only':'Unavailable'];
 $('.web-services summary').textContent='Services · '+services.filter(x=>!x.includes('unavailable')&&x!=='Unavailable').length+' connected';
 document.querySelectorAll('.web-services dd').forEach((el,i)=>el.textContent=services[i]);
}
addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==hostOrigin||event.data?.protocol!==protocol)return;
 const d=event.data;
 if(d.type==='view'){
  const immersive=d.immersive===true;
  if(document.body.classList.contains('web-immersive')===immersive)return;
  const composer=$('#webComposer'),newButton=$('#webNew'),focused=document.activeElement;
  document.body.classList.toggle('web-immersive',immersive);
  if(immersive){$('#assistantWeb .web-dock').append(composer,newButton);}
  else{$('#assistantWeb .web-controls').before(composer);$('#assistantWeb .web-conversation header').appendChild(newButton);}
  if(composer.contains(focused)||focused===newButton)focused.focus({preventScroll:true});
  window.dispatchEvent(new Event('resize'));
  return;
 }
 if(d.type==='host-ready'){request('ready');return;}
 if(d.type==='reset'){$('#webRetry').hidden=true;activeRequest='';sessions.splice(0,sessions.length,{id:crypto.randomUUID(),messages:[]});currentSession=sessions[0];input.value='';runtime=null;connected=false;setState('idle');renderMessages();serviceStatus();return;}
 if(d.type==='bootstrap'||d.type==='sessions'){
  connected=true;if(d.runtime)runtime=d.runtime;
  sessions.splice(0,sessions.length,...d.sessions.map(x=>({...x,messages:[]})));currentSession=sessions.find(x=>x.id===d.session_id)||sessions[0];
  if(!currentSession)return;renderMessages();serviceStatus();showNotice(runtime?.ready?'Conversation ready. Expand Services to see authorized capabilities.':'Text service unavailable. Check Native Assistant in AI Integrations.');return;
 }
 if(d.type==='history'){
  const selected=sessions.find(x=>x.id===d.session_id);if(!selected)return;currentSession=selected;activeRequest='';
  currentSession.messages=d.turns.flatMap(messagesForTurn);
  restoreActivity(d.turns);
  $('#webRetry').hidden=true;renderMessages();setState('idle');return;
 }
 if(d.type==='resume'){activeRequest=d.request_id;$('#webStop').hidden=false;showNotice('Recovering the active request…');return;}
 if(d.type==='cancelled'){$('#webRetry').hidden=!currentSession.messages.some(m=>m.role==='user');activeRequest='';$('#webStop').hidden=true;setState('idle');showNotice('Response stopped. Late replies will not be displayed.');return;}
 if(d.type==='error'){
  if(d.request_id&&activeRequest&&d.request_id!==activeRequest)return;
  activity('Error');$('#webRetry').hidden=!currentSession.messages.some(m=>m.role==='user');activeRequest='';$('#webStop').hidden=true;setState('error');showNotice(d.message||'Assistant unavailable.',true);return;
 }
 if(d.type==='transcript'&&typeof d.text==='string'){handle(d.text.slice(0,2000));return;}
 if(d.type==='voice_preview'){
  const preview=$('#webVoicePreview');
  preview.hidden=!d.text;
  preview.textContent=d.text?(d.assistant?'Assistant (partial): ':'You (partial): ')+d.text:'';
  return;
 }
 if(d.type==='voice_turn'){
  if(d.session_id!==currentSession.id||!d.turn)return;
  if(d.turn.state==='completed')activity('Completed');
  if(d.turn.state==='failed')activity('Error');
  if(d.turn.error_code==='voice_interrupted')activity('Interrupted');
  const id=d.turn.request_id;
  const index=currentSession.messages.findIndex(m=>m.request_id===id);
  const replacement=messagesForTurn(d.turn);
  if(index<0)currentSession.messages.push(...replacement);
  else currentSession.messages.splice(index,currentSession.messages.filter(m=>m.request_id===id).length,...replacement);
  renderMessages();return;
 }
 if(d.type==='voice_error'){showNotice(d.message||'Voice service unavailable.',true);return;}
 if(d.type==='voice_level'){window.FEEDX_AUDIO_LEVEL=Math.max(0,Math.min(1,Number(d.level)||0));return;}
 if(d.type==='voice_state'){
  document.body.dataset.voiceState=d.state;
  $('#webLiveState').textContent=({connecting:'Connecting',listening:'Listening',transcribing:'Processing',executing:'Querying Factory',speaking:'Speaking',interrupted:'Interrupted',error:'Error',playback_blocked:'Playback blocked'})[d.state]||'Idle';
  activity(({transcribing:'Processing',executing:'Querying Factory',error:'Error'})[d.state]);
  const states={interrupted:'listening',listening:'listening',transcribing:'thinking',executing:'executing',speaking:'speaking',error:'error'};window.FEEDX_AUDIO_LEVEL=0;if(states[d.state])setState(states[d.state]);else if(!activeRequest)setState('idle');return;}
 if(d.request_id!==activeRequest)return;
 if(d.type==='state'&&d.state==='executing'){activity('Querying Factory');setState('executing');showNotice('Reading authorized Factory Finished Goods…');}
 if(d.type==='state'&&d.state==='thinking'){activity('Understanding');setState('thinking');showNotice('Thinking…');}
 if(d.type==='result'&&typeof d.reply==='string'){activity('Completed');
  currentSession.messages.push({role:'assistant',text:d.reply.slice(0,3000),request_id:activeRequest,evidence:d.evidence});activeRequest='';renderMessages();setState('idle');showNotice(d.evidence?'Response received · verified read evidence attached.':'Response received.');
 }
});
// The renderer is unchanged; error is a non-speaking, idle-shaped visual state.
STATES.executing=STATES.thinking;STATE_LABEL.executing='Executing · read only';
STATES.error=STATES.idle;STATE_LABEL.error='Error';
if(parent!==window)request('ready');

// 2026-11-04: resize clears WebGL buffers; repaint the frozen scene without advancing time.
addEventListener('resize',()=>{if(window.FEEDX_VISUAL_PAUSED&&!document.hidden)requestAnimationFrame(()=>composer.render());});
