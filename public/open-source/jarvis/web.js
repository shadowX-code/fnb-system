/* FeedX Staging browser adaptation, 2026-11-03. GPL-3.0.
 * Derived from the independent pilot.js UUID/fencing and original HUD state bridge.
 * No provider engine, credentials, network transport or simulated AI responses.
 */
'use strict';
let pilotSession;try{pilotSession=sessionStorage.getItem('feedx.pilot.session');if(!pilotSession){pilotSession=crypto.randomUUID();sessionStorage.setItem('feedx.pilot.session',pilotSession);}}catch{pilotSession=crypto.randomUUID();}
let activeRequest='',captureEpoch=0;
const sessions=[{id:pilotSession,messages:[]}];
let currentSession=sessions[0];
const web=document.createElement('section');web.id='assistantWeb';
web.innerHTML=`<div class="web-core-caption"><span class="web-status-dot"></span><strong>Visual ready</strong><p>Original Jarvis Core · no active AI service</p><button type="button" id="webPause">Pause motion</button></div>
<section class="web-conversation" aria-label="AI conversation"><header><h1>Conversation</h1><button type="button" id="webNew">New</button></header>
<label class="web-history-label" for="webHistory">Conversation history <span>this tab only</span></label><select id="webHistory"></select>
<details class="web-services"><summary>Services · 4 unavailable</summary><dl><div><dt>Language model</dt><dd>Not configured</dd></div><div><dt>Speech recognition</dt><dd>Not connected</dd></div><div><dt>Voice output</dt><dd>Not connected</dd></div><div><dt>FeedX tools</dt><dd>Not authorized</dd></div></dl></details>
<div id="webNotice" role="status">No model is connected. Requests stay in this tab; no AI answer will be generated.</div>
<ol id="webMessages" aria-label="Conversation messages" aria-live="polite"></ol>
<div id="webComposer"></div><div class="web-controls"><button type="button" id="webVoice" aria-disabled="true" title="No authorized voice service is connected">Voice unavailable</button><button type="button" id="webStop">Stop</button></div>
<p class="web-privacy">No messages leave this page. Reload clears this tab's history while the conversation service is unavailable.</p>
<footer class="web-license"><a href="source.zip" download>HUD source · GPL-3.0</a><a href="LICENSE.txt" download>License</a></footer></section>`;
document.body.appendChild(web);
const notice=$('#webNotice'),messageList=$('#webMessages'),history=$('#webHistory');
$('#webComposer').appendChild($('#form'));
input.setAttribute('aria-label','Message AI Assistant');input.placeholder='Ask FeedX…';input.maxLength=2000;
$('#mic').setAttribute('aria-label','Microphone unavailable');$('#mic').setAttribute('aria-disabled','true');$('#mic').title='No authorized speech recognition service is connected';
const submit=document.createElement('button');submit.type='submit';submit.id='webSend';submit.textContent='Send';$('#form').appendChild(submit);
function showNotice(text,error=false){notice.textContent=text;notice.setAttribute('role',error?'alert':'status');notice.dataset.error=String(error);}
function renderHistory(){history.replaceChildren(...sessions.map((s,i)=>{const option=document.createElement('option');option.value=s.id;option.textContent=s.messages[0]?.text.slice(0,48)||`Conversation ${i+1}`;return option;}));history.value=currentSession.id;}
function renderMessages(){messageList.replaceChildren();if(!currentSession.messages.length){const empty=document.createElement('li');empty.className='web-empty';empty.textContent='Start with a question. Your request will appear here; responses require an authorized model connection.';messageList.appendChild(empty);}for(const message of currentSession.messages){const item=document.createElement('li');const label=document.createElement('strong');label.textContent='You';const text=document.createElement('p');text.textContent=message.text;item.append(label,text);messageList.appendChild(item);}messageList.scrollTop=messageList.scrollHeight;renderHistory();}
// Same request/session identity boundary as the pilot. No remote engine is configured.
let handle=function(text){text=text.trim();if(!text)return;captureEpoch++;activeRequest=crypto.randomUUID();if(currentSession.messages.length>=20){showNotice('This conversation reached its local request limit. Start a new conversation.',true);return;}currentSession.messages.push({request_id:activeRequest,text:text.slice(0,2000)});renderMessages();setState('idle');document.body.dataset.serviceState='unavailable';showNotice('Language model unavailable. Your request was not sent and no AI answer was generated.',true);};
$('#form').addEventListener('submit',event=>{event.preventDefault();handle(input.value);input.value='';});
$('#webNew').onclick=()=>{activeRequest='';captureEpoch++;pilotSession=crypto.randomUUID();currentSession={id:pilotSession,messages:[]};sessions.push(currentSession);if(sessions.length>6)sessions.shift();input.value='';renderMessages();setState('idle');showNotice('New conversation. No model is connected; history stays in this tab.');input.focus();};
history.onchange=()=>{activeRequest='';captureEpoch++;currentSession=sessions.find(s=>s.id===history.value)||sessions[0];input.value='';renderMessages();setState('idle');showNotice('Conversation opened. No AI service is connected.');};
$('#mic').onclick=()=>showNotice('Speech recognition unavailable. No microphone was opened. You can type your request.',true);
$('#webVoice').onclick=()=>showNotice('Voice output unavailable. The local Kokoro runtime is not a web-connected service.',true);
$('#webStop').onclick=()=>{activeRequest='';captureEpoch++;setState('idle');showNotice('Stopped. No AI generation, recording or playback is running.');};
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
