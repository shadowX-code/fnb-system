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
let currentSession={id:pilotSession,messages:[]},hasOlder=false;
function isPendingVoiceReply(turn) {
 return turn.error_code === 'voice_unfinished' && !turn.finished_at && !turn.voice_details?.reason && !turn.reply;
}
function messagesForTurn(t){
 const status={voice_interrupted:'Interrupted — this reply was stopped before completion',voice_transcript_unavailable:'Assistant transcript unavailable',voice_unfinished:'Response unfinished',voice_failed:'Response failed'};
 return [{role:'user',text:t.prompt,request_id:t.request_id,voice:t.voice,time:t.created_at},...(t.state==='completed'&&t.reply?
 [{role:'assistant',text:t.reply,request_id:t.request_id,evidence:t.evidence,voice:t.voice,time:t.finished_at,usage:{input_tokens:t.input_tokens,output_tokens:t.output_tokens,model:t.model,context:t.context_usage}}]:
 t.voice&&status[t.error_code]&&!isPendingVoiceReply(t)?[{role:'assistant',text:t.reply||'',outcome:t.error_code,reason:t.voice_details?.reason,request_id:t.request_id,voice:true,evidence:t.evidence,time:t.finished_at}]:[])];
}

// Presentation symbols and waveforms are authored here. No audio levels are inferred.
const hudPaths={
 understand:'M4 5h16v11H9l-5 4z M8 10h.1m4 0h.1m4 0h.1',
 thinking:'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6 3 3M6 18l3-3m6-6 3-3',
 factory:'M3 20V9l6 4V8l6 4 2-8h4v16z M7 16v1m5-1v1m5-1v1',
 speech:'M3 11v2m4-5v8m5-12v16m5-12v8m4-5v2',
 done:'m5 12 5 5L20 7',
 pause:'M9 5v14m6-14v14',
 alert:'M12 4 2 20h20L12 4zm0 6v4m0 3h.01',
 box:'M12 3 3 8v9l9 5 9-5V8zm0 10v9M3 8l9 5 9-5M7 6l9 5',
 spark:'M12 3c0 6-3 9-9 9 6 0 9 3 9 9 0-6 3-9 9-9-6 0-9-3-9-9z',
};
const hudIcon=name=>`<svg class="web-hud-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${hudPaths[name]}"/></svg>`;
const voiceWave=`<svg class="web-real-audio" viewBox="0 0 240 48" aria-hidden="true">${Array.from({length:20},(_,i)=>`<line x1="${i*12+5}" x2="${i*12+5}" y1="3" y2="45" style="transform-origin:${i*12+5}px 24px;transform:scaleY(calc(.025 + var(--voice-band-${i},0)*.975))"/>`).join('')}</svg>`;

const web=document.createElement('section');web.id='assistantWeb';
web.innerHTML=`<div class="web-reticle" aria-hidden="true"><i></i><b></b><span></span></div>
<div class="web-core-name" aria-hidden="true">J A R V I S</div>
<aside class="web-telemetry" aria-label="Session telemetry">
<section class="web-hud-panel"><h2>Agent activity</h2><ol id="webActivity"><li class="web-activity-idle">Waiting for a request</li></ol></section>
<section class="web-hud-panel"><h2>Current session</h2><div class="web-session-body"><div class="web-session-ring"><strong id="webTurnCount">0</strong><span>Turns</span></div><dl id="webSessionFacts"></dl></div><details class="web-voice-diagnostics"><summary>Session details</summary><div id="webVoiceDiagnostics">No call diagnostics yet.</div></details></section>
<section class="web-hud-panel"><h2>Voice state</h2><div class="web-voice-state">${voiceWave}</div><p id="webVoiceAvailability" role="status"></p><div class="web-voice-actions"><button type="button" id="webVoiceResume" hidden>Resume audio</button><button type="button" id="webVoiceRefresh">Check availability</button><button type="button" id="webVoiceUsage">Usage &amp; limits</button></div></section>
</aside>
<section class="web-conversation" aria-label="AI conversation"><section class="web-operations" aria-label="Operations intelligence"><h2>Operations intelligence</h2><div id="webOperations"></div></section><header><h1>Conversation</h1><button type="button" id="webNew" aria-label="New Conversation">New</button></header>
<button type="button" id="webOlder" hidden>Load older messages</button>
<details class="web-services"><summary>Services · 4 unavailable</summary><dl><div><dt>Language model</dt><dd>Not configured</dd></div><div><dt>Speech recognition</dt><dd>Not connected</dd></div><div><dt>Voice output</dt><dd>Not connected</dd></div><div><dt>FeedX tools</dt><dd>Not authorized</dd></div></dl></details>
<div id="webNotice" role="status">Connecting to FeedX…</div>
<p id="webVoicePreview" class="web-privacy" hidden></p>
<ol id="webMessages" aria-label="Conversation messages" aria-live="polite"></ol>
<div id="webComposer"></div><div class="web-controls"><button type="button" id="webVoice" aria-disabled="true" title="No authorized voice service is connected">Voice unavailable</button><button type="button" id="webStop">Stop</button><button type="button" id="webRetry" hidden>Retry last question</button></div>
<p class="web-privacy">Your enabled model processes text. Audio is not retained. Business reads recheck Admin access. Conversations are private to your FeedX account.</p>
<footer class="web-license"><a href="source.zip" download>HUD source · GPL-3.0</a><a href="LICENSE.txt" download>License</a></footer></section><div class="web-dock" aria-label="Conversation controls"></div>`;
document.body.appendChild(web);
const notice=$('#webNotice'),messageList=$('#webMessages'),older=$('#webOlder');
$('#webComposer').appendChild($('#form'));
const composerSurface = $('#webComposer');
const composePanel = document.createElement('div');
composePanel.id = 'webComposePanel';
const composeToggle = document.createElement('button');
composeToggle.type = 'button';
composeToggle.id = 'webComposeToggle';
composeToggle.setAttribute('aria-controls', composerSurface.id);
composeToggle.innerHTML = hudIcon('understand') + '<span>Text</span>';
composePanel.append(composeToggle, composerSurface);
$('.web-dock').append(composePanel);

function setComposerOpen(open, moveFocus = false) {
 composeToggle.setAttribute('aria-expanded', String(open));
 composePanel.dataset.open = String(open);
 composerSurface.inert = !open;
 if (open) {
  fitComposer();
  if (moveFocus) input.focus({ preventScroll: true });
 } else if (moveFocus) {
  composeToggle.focus({ preventScroll: true });
 }
}
composeToggle.onclick = () => setComposerOpen(composePanel.dataset.open !== 'true', true);
setComposerOpen(true);

const telemetry = $('.web-telemetry');
const conversation = $('.web-conversation');
const telemetryToggle = document.createElement('button');
telemetryToggle.type = 'button';
telemetryToggle.className = 'web-telemetry-toggle';
telemetryToggle.textContent = 'Session panels';
telemetry.id = 'webTelemetry';
telemetryToggle.setAttribute('aria-controls', telemetry.id);
telemetryToggle.setAttribute('aria-expanded', 'false');
telemetryToggle.onclick = () => {
 const open = telemetryToggle.getAttribute('aria-expanded') !== 'true';
 telemetryToggle.setAttribute('aria-expanded', String(open));
 telemetry.dataset.mobileOpen = String(open);
};
conversation.prepend(telemetryToggle);
const narrowHud = matchMedia('(max-width: 800px)');
function placeTelemetry() {
 if (narrowHud.matches) telemetryToggle.after(telemetry);
 else web.insertBefore(telemetry, conversation);
}
narrowHud.addEventListener('change', placeTelemetry);
placeTelemetry();
input.setAttribute('aria-label','Message AI Assistant');input.placeholder='Ask FeedX…';input.maxLength=2000;
$('#mic').setAttribute('aria-label','Microphone unavailable');$('#mic').setAttribute('aria-disabled','true');$('#mic').title='No authorized speech recognition service is connected';
const submit=document.createElement('button');submit.type='button';submit.id='webSend';submit.textContent='Send';$('#form').appendChild(submit);
function showNotice(text,error=false){submit.disabled=!!activeRequest||document.body.dataset.voiceLocked==='true';submit.textContent=activeRequest?'Sending…':'Send';notice.textContent=text;notice.setAttribute('role',error?'alert':'status');notice.dataset.error=String(error);}
function renderIntelligence(){
 const messages=currentSession.messages;
 const reads=messages.filter(m=>m.evidence?.capability==='read_factory_finished_goods');
 const evidence=reads.at(-1)?.evidence;
 const facts=$('#webSessionFacts');
 facts.replaceChildren();
 $('.web-session-ring span').textContent=hasOlder?'Turns shown':'Turns';
 $('#webTurnCount').textContent=messages.filter(m=>m.role==='user').length;
 for(const [label,value,icon] of [[hasOlder?'Evidence shown':'Factory evidence',reads.length,'factory'],[hasOlder?'Replies shown':'Completed replies',messages.filter(m=>m.role==='assistant'&&!m.outcome).length,'done']]){
  const name=document.createElement('dt'), count=document.createElement('dd');
  name.innerHTML=hudIcon(icon);name.append(label);count.textContent=value;facts.append(name,count);
 }
 const operations=$('#webOperations');
 operations.replaceChildren();
 if(!evidence){operations.textContent='Factory insights appear after an authorized read.';return;}
 const metrics=document.createElement('dl');
 const values=[
  ['Below minimum',evidence.availability==='low'?evidence.total_matching:null,'low','box'],
  ['Unknown minimum',evidence.unknown_minimum_count,'unknown','alert'],
 ];
 for(const [label,value,severity,icon] of values){
  if(!Number.isInteger(value))continue;
  const tile=document.createElement('div'),name=document.createElement('dt'),count=document.createElement('dd');
  tile.dataset.severity=severity;name.textContent=label;count.textContent=value;
  const badge=document.createElement('span');badge.className='web-metric-icon';badge.innerHTML=hudIcon(icon);tile.append(badge,name,count);metrics.append(tile);
 }
 const link=document.createElement('a');
 link.href=hostOrigin+'/factory/warehouse/finished-goods';link.target='_blank';link.rel='noopener noreferrer';
 link.textContent='Factory · Finished Goods ↗';
 const scope=document.createElement('p');
 scope.textContent=[evidence.scope,evidence.query?'Filter: '+evidence.query:'',evidence.as_of?new Date(evidence.as_of).toLocaleString():''].filter(Boolean).join(' · ');
 operations.append(metrics,link,scope);
}
const activityPhases = {
 processing: ['Processing', 'thinking'],
 executing: ['Reading', 'factory'],
 speaking: ['Speaking', 'speech'],
 complete: ['Completed', 'done'],
 interrupted: ['Interrupted', 'pause'],
 cancelled: ['Cancelled', 'pause'],
 unfinished: ['Incomplete', 'alert'],
 unavailable: ['Transcript unavailable', 'alert'],
 denied: ['Access denied', 'alert'],
 failed: ['Failed', 'alert'],
};
const terminalPhases = new Set(['complete', 'interrupted', 'cancelled', 'unfinished', 'unavailable', 'denied', 'failed']);
const activityRows = new Map();
const activityList = $('#webActivity');

function activity(id, phase, details = {}) {
 if (!id || !activityPhases[phase]) return;
 let entry = activityRows.get(id);
 if (!entry) {
  const row = document.createElement('li');
  row.innerHTML = '<span class="web-event-node" aria-hidden="true"></span><div class="web-activity-copy"><strong></strong><small></small><details hidden><summary>Factory reads</summary><ul></ul></details></div>';
  entry = { row, operations: new Map() };
  activityRows.set(id, entry);
  activityList.querySelector('.web-activity-idle')?.remove();
  if (details.older) activityList.append(row);
  else activityList.prepend(row);
 }
 const at = Number.isFinite(details.at) ? details.at : undefined;
 entry.voice ||= details.voice;
 entry.evidence ||= Boolean(details.evidence);
 entry.factory ||= details.factory;
 if (details.prompt && details.prompt !== 'Voice transcript unavailable') {
  const prompt = details.prompt.replace(/\s+/g, ' ').trim();
  if (prompt) entry.prompt = prompt.length > 56 ? prompt.slice(0, 55) + '…' : prompt;
 }
 if (details.operation != null) {
  let operation = entry.operations.get(details.operation);
  if (!operation) {
   const item = document.createElement('li');
   entry.row.querySelector('ul').append(item);
   operation = { item, started: at };
   entry.operations.set(details.operation, operation);
  }
  const elapsed = terminalPhases.has(phase) ? activityDuration(operation.started, at) : '';
  operation.phase = phase;
  operation.item.textContent = ['Factory Finished Goods', activityPhases[phase][0], elapsed].filter(Boolean).join(' · ');
  entry.row.querySelector('details').hidden = false;
  entry.row.querySelector('summary').textContent = 'Factory reads (' + entry.operations.size + ')';
  if (!terminalPhases.has(entry.phase) && phase === 'executing') entry.phase = phase;
  entry.started ??= at;
 } else if (!terminalPhases.has(entry.phase) && (!details.recorded || !entry.phase || terminalPhases.has(phase))) {
  entry.phase = phase;
  entry.started ??= Number.isFinite(details.started) ? details.started : at;
  if (terminalPhases.has(phase)) entry.finished = at;
 }
 const [status, icon] = activityPhases[entry.phase || 'processing'];
 entry.row.dataset.stage = entry.phase || 'processing';
 entry.row.querySelector('.web-event-node').innerHTML = hudIcon(icon);
 entry.row.querySelector('strong').textContent = entry.evidence || entry.operations.size || entry.factory
  ? 'Factory Finished Goods' : entry.prompt || (entry.voice ? 'Voice response' : 'Text response');
 const elapsed = activityDuration(entry.started, entry.finished);
 entry.row.querySelector('small').textContent = [status, elapsed, entry.evidence && 'Evidence in Conversation'].filter(Boolean).join(' · ');
}

function activityDuration(started, finished) {
 const elapsed = finished - started;
 return Number.isFinite(elapsed) && elapsed >= 0 ? (elapsed / 1000).toFixed(1) + ' s' : '';
}

function showRecordedActivity(turn, older = false) {
 let phase = {
  voice_interrupted: 'interrupted', voice_transcript_unavailable: 'unavailable',
  voice_failed: 'failed', voice_unfinished: 'unfinished',
 }[turn.error_code];
 if (!phase) phase = { completed: 'complete', failed: 'failed', cancelled: 'cancelled' }[turn.state] || 'processing';
 if (isPendingVoiceReply(turn)) {
  phase = turn.tool_state === 'executing' ? 'executing' : 'processing';
 }
 activity(turn.request_id, phase, {
  voice: turn.voice, prompt: turn.prompt, evidence: turn.evidence, factory: Boolean(turn.tool_state),
  started: Date.parse(turn.created_at), at: Date.parse(turn.finished_at), older, recorded: true,
 });
 const operations = activityRows.get(turn.request_id)?.operations;
 if (turn.tool_state === 'failed' && operations && ![...operations.values()].some(op => op.phase === 'failed' || op.phase === 'denied')) {
  activity(turn.request_id, 'failed', { operation: 'recorded-read' });
 }
}

function restoreActivity(turns) {
 activityRows.clear();
 activityList.replaceChildren();
 for (const turn of turns) showRecordedActivity(turn);
 if (!activityRows.size) {
  const idle = document.createElement('li');
  idle.className = 'web-activity-idle';
  idle.textContent = 'Waiting for a request';
  activityList.append(idle);
 }
}
// Provider totals are measured; context and USD are explicitly estimates, never invoices.
function appendResponseDetails(item,message){
 if(message.role!=='assistant')return;
 const usage=message.usage,context=usage?.context;
 if(!usage&&!message.outcome)return;
 const details=document.createElement('details'),label=document.createElement('summary');
 details.className='web-response-details';label.textContent=message.outcome?'Reply status':'Response details';details.append(label);
 const note=document.createElement('p');
 if(message.outcome){const reasons={max_output_tokens:'The provider reached the reply-length safety limit.',content_filter:'The provider stopped this reply for safety.',provider_cancelled:'The provider cancelled this response.',transport_disconnected:'The voice connection was lost.',session_expired:'The session duration limit was reached.',lease_failed:'The session could not be renewed.',provider_error:'The voice provider reported an error.',session_ended:'Voice ended before this reply completed.',turn_limit:'The call reached its turn safety limit.'};note.textContent=(reasons[message.reason]||'No completed assistant reply is available.')+' Any text shown is a partial transcript. Ask again explicitly or reconnect Voice; no read is retried automatically.';details.append(note);}
 if(Number.isInteger(usage?.input_tokens)&&Number.isInteger(usage?.output_tokens)){
  const tokens=document.createElement('p');tokens.textContent=`Provider-reported tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`;details.append(tokens);
  if(Number.isFinite(context?.estimated_usd)){const cost=document.createElement('p');cost.textContent=`Estimated text cost: US$${context.estimated_usd.toFixed(6)} · uncached list rates (${context.pricing_version}); not an invoice`;details.append(cost);}
 }
 if(context){const info=document.createElement('p');info.textContent=`Context estimate: ${context.estimated_context_tokens} / ${context.budget_tokens} tokens · ${context.recent_turns} recent turns · ${context.summarized_turns} older turns indexed (${context.version}). Original messages remain in History.`;details.append(info);
  for(const source of context.recall_sources||[]){const button=document.createElement('button');button.type='button';button.textContent=`History source: ${source.title} · turn ${source.seq}`;button.onclick=()=>request('history',{session_id:source.session_id});details.append(button);}
 }
 if(details.children.length>1)item.append(details);
}
function renderMessages({prepend=false,reset=false}={}){
 const mobileImmersive=narrowHud.matches&&document.body.classList.contains('web-immersive');
 const scroller=mobileImmersive?conversation:messageList;
 const previousHeight=scroller.scrollHeight,previousTop=scroller.scrollTop,nearBottom=previousHeight-previousTop-scroller.clientHeight<80;renderIntelligence();older.hidden=!hasOlder;older.disabled=false;$('#webStop').hidden=!activeRequest;messageList.replaceChildren();if(!currentSession.messages.length){const empty=document.createElement('li');empty.className='web-empty';empty.textContent=connected&&!currentSession.id?'What would you like to work on? Ask a question here, or open a private conversation from History.':'Start with a question. Your request will appear here; responses require an authorized model connection.';messageList.appendChild(empty);}for(const message of currentSession.messages){const item=document.createElement('li');item.dataset.speaker=message.role;if(message.outcome)item.dataset.outcome=message.outcome;const avatar=document.createElement('span');avatar.className='web-message-avatar';avatar.innerHTML=hudIcon(message.role==='assistant'?'spark':message.voice?'speech':'understand');const label=document.createElement('strong');label.textContent=(message.role==='assistant'?'Assistant':'You')+(message.voice?' · Voice':'');const text=document.createElement('p');for(const part of message.text.split(/(\*\*[^*]+\*\*)/g)){if(part.startsWith('**')&&part.endsWith('**')){const bold=document.createElement('strong');bold.textContent=part.slice(2,-2);text.append(bold);}else text.append(document.createTextNode(part));}item.append(avatar,label);
 if(message.time&&Number.isFinite(Date.parse(message.time))){const time=document.createElement('time');time.dateTime=message.time;time.textContent=new Date(message.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});item.append(time);}
 item.append(text);if(message.outcome){const outcome=document.createElement('span');outcome.className='web-outcome-label';outcome.textContent=message.outcome==='voice_interrupted'?'Interrupted':message.outcome==='voice_unfinished'?'Incomplete reply':message.outcome==='voice_failed'?'Reply failed':'Transcript unavailable';item.append(outcome);}if(message.evidence?.capability==='read_factory_finished_goods'){const evidence=document.createElement('details');evidence.className='web-evidence';const heading=document.createElement('summary');heading.textContent='Factory read · '+message.evidence.returned+'/'+message.evidence.total_matching+' matches';evidence.append(heading);const badge=document.createElement('span');badge.className='web-evidence-icon';badge.innerHTML=hudIcon('factory');const link=document.createElement('a');link.href='https://fnb-system-staging.vercel.app/factory/warehouse/finished-goods';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Factory · Finished Goods ↗';const stamp=document.createElement('span');stamp.textContent=`${message.evidence.scope} · ${message.evidence.as_of} · ${message.evidence.returned}/${message.evidence.total_matching} matches${Number.isInteger(message.evidence.unknown_minimum_count)?' · '+message.evidence.unknown_minimum_count+' unknown minimums':''}`;const note=document.createElement('p');note.textContent=message.evidence.limitations;evidence.append(badge,link,stamp,note);item.append(evidence);}appendResponseDetails(item,message);messageList.appendChild(item);}
 scroller.scrollTop=prepend?previousTop+scroller.scrollHeight-previousHeight:reset&&mobileImmersive?0:reset||nearBottom?scroller.scrollHeight:previousTop;
}
// Same request/session identity boundary as the pilot. No remote engine is configured.
let handle=function(text){text=text.trim();if(!text)return;if(document.body.dataset.voiceLocked==='true'){showNotice('End voice before sending a text message.',true);return;}if(activeRequest){showNotice('Stop the current response before sending another request.',true);return;}
 $('#webRetry').hidden=true;activeRequest=crypto.randomUUID();currentSession.messages.push({request_id:activeRequest,role:'user',text:text.slice(0,2000)});renderMessages();
 if(connected){parent.postMessage({protocol,action:'send',request_id:activeRequest,session_id:currentSession.id,text:text.slice(0,2000)},hostOrigin);showNotice('Submitting request…');}
 else{activeRequest='';setState('idle');showNotice('Language model unavailable. Your request was not sent and no AI answer was generated.',true);}
};
// Sandboxed frames deliberately disallow form submission; use explicit local actions.
function sendLocalRequest(){if(document.body.dataset.voiceLocked==='true'){handle(input.value);return;}handle(input.value);input.value='';fitComposer();}
submit.onclick=sendLocalRequest;
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendLocalRequest();}});
function fitComposer(){input.style.height='auto';const height=Math.max(40,Math.min(110,input.scrollHeight));input.style.height=height+'px';document.body.style.setProperty('--composer-space',(height+24)+'px');}
input.addEventListener('input',fitComposer);addEventListener('resize',fitComposer);
$('#form').addEventListener('submit',event=>event.preventDefault());
$('#webNew').onclick=()=>{if(connected){request('new');return;}activeRequest='';captureEpoch++;currentSession={id:crypto.randomUUID(),messages:[]};input.value='';renderMessages();setState('idle');showNotice('New conversation. No model is connected; history stays in this tab.');input.focus();};
older.onclick=()=>{older.disabled=true;request('older');};
$('#mic').style.display='none';$('#webVoice').style.display='none';
$('#mic').onclick=()=>showNotice('Speech recognition unavailable. No microphone was opened. You can type your request.',true);
$('#webVoice').onclick=()=>showNotice('Voice output unavailable. Use the voice control above the conversation.',true);
$('#webVoiceResume').onclick=()=>request('voice_resume');
$('#webVoiceRefresh').onclick=()=>request('voice_refresh');
$('#webVoiceUsage').onclick=()=>request('voice_usage');
$('#webRetry').onclick=()=>{const last=[...currentSession.messages].reverse().find(m=>m.role==='user');if(last)handle(last.text);};
$('#webStop').onclick=()=>{if(connected)request('cancel');activity(activeRequest,'cancelled',{at:Date.now()});activeRequest='';captureEpoch++;setState('idle');showNotice('Stopped. No AI generation, recording or playback is running.');};
addEventListener('keydown', event => {
 if (event.key !== 'Escape') return;
 if (document.body.classList.contains('web-immersive') && composePanel.dataset.open === 'true') {
  event.preventDefault();
  setComposerOpen(false, true);
 } else if (activeRequest) {
  $('#webStop').click();
 }
});
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
function updateMotion(){window.FEEDX_VISUAL_PAUSED=motionPreference.matches;}
motionPreference.addEventListener('change',updateMotion);updateMotion();
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
 const services=[ready?'Text · '+runtime.model:'Unavailable',runtime?.voice_provider?'Configured · '+runtime.voice_provider+' (start a voice session)':'Unavailable',runtime?.voice_provider?'Configured · '+runtime.voice_provider+' (start a voice session)':'Unavailable',runtime?.tools?'Factory Finished Goods · read only':'Unavailable'];
 $('.web-services summary').textContent='Authorized capabilities';
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
  setComposerOpen(!immersive || composer.contains(focused));
  if(immersive){$('#assistantWeb .web-dock').append(newButton);}
  else{$('#assistantWeb .web-conversation header').appendChild(newButton);}
  if(composer.contains(focused)||focused===newButton)focused.focus({preventScroll:true});
  window.dispatchEvent(new Event('resize'));
  return;
 }
 if(d.type==='host-ready'){request('ready');return;}
 if(d.type==='reset'){
  $('#webRetry').hidden=true;activeRequest='';currentSession={id:null,messages:[]};hasOlder=false;input.value='';runtime=null;connected=false;delete document.body.dataset.voiceLocked;
  restoreActivity([]);setState('idle');renderMessages();serviceStatus();showNotice('Loading your conversation…');return;
 }
 if(d.type==='voice_lock'){
  document.body.dataset.voiceLocked=String(d.active===true);
  submit.disabled=$('#webNew').disabled=d.active===true;
  input.readOnly=d.active===true;input.placeholder=d.active?'End Voice to type a message…':'Ask FeedX…';
  return;
 }
 if(d.type==='bootstrap'||d.type==='runtime'){
  connected=true;if(d.runtime)runtime=d.runtime;
  serviceStatus();showNotice(runtime?.ready?'Conversation ready. Expand Services to see authorized capabilities.':'Text service unavailable. Check Native Assistant in AI Integrations.');return;
 }
 if(d.type==='session'){currentSession.id=d.session_id;return;}
 if(d.type==='empty'){
  currentSession={id:null,messages:[]};hasOlder=false;restoreActivity([]);renderMessages({reset:true});return;
 }
 if(d.type==='history'){
  currentSession={id:d.session_id,messages:d.turns.flatMap(messagesForTurn)};hasOlder=d.has_more===true;activeRequest='';input.value='';
  restoreActivity(d.turns);
  $('#webRetry').hidden=true;renderMessages({reset:true});setState('idle');return;
 }
 if(d.type==='older'){
  if(currentSession.id!==d.session_id)return;
  const existing=new Set(currentSession.messages.map(message=>message.request_id));
  const olderTurns=d.turns.filter(turn=>!existing.has(turn.request_id));
  currentSession.messages.unshift(...olderTurns.flatMap(messagesForTurn));hasOlder=d.has_more===true;
  for (const turn of [...olderTurns].reverse()) showRecordedActivity(turn,true);
  renderMessages({prepend:true});return;
 }
 if(d.type==='history_error'){older.disabled=false;showNotice(d.message||'Older messages are unavailable.',true);return;}
 if(d.type==='resume'){activeRequest=d.request_id;$('#webStop').hidden=false;showNotice('Recovering the active request…');return;}
 if(d.type==='cancelled'){activity(activeRequest,'cancelled',{at:Date.now()});$('#webRetry').hidden=!currentSession.messages.some(m=>m.role==='user');activeRequest='';$('#webStop').hidden=true;setState('idle');showNotice('Response stopped. Late replies will not be displayed.');return;}
 if(d.type==='error'){
  if(d.request_id&&activeRequest&&d.request_id!==activeRequest)return;
  if(activeRequest)activity(activeRequest,'failed',{at:Date.now()});$('#webRetry').hidden=!currentSession.messages.some(m=>m.role==='user');activeRequest='';$('#webStop').hidden=true;setState('error');showNotice(d.message||'Assistant unavailable.',true);return;
 }
 if(d.type==='transcript'&&typeof d.text==='string'){handle(d.text.slice(0,2000));return;}
 if(d.type==='voice_preview'){
  const preview=$('#webVoicePreview');
  preview.hidden=!d.text;
  preview.textContent=d.text?(d.assistant?'Assistant (partial): ':'You (partial): ')+d.text:'';
  return;
 }
 if(d.type==='voice_activity'){
  if(d.session_id===currentSession.id) activity(d.turn_id,d.phase,{...d,voice:true});
  return;
 }
 if(d.type==='voice_turn'){
  if(d.session_id!==currentSession.id||!d.turn)return;
  showRecordedActivity(d.turn);
  const id=d.turn.request_id;
  const index=currentSession.messages.findIndex(m=>m.request_id===id);
  const replacement=messagesForTurn(d.turn);
  if(index<0)currentSession.messages.push(...replacement);
  else currentSession.messages.splice(index,currentSession.messages.filter(m=>m.request_id===id).length,...replacement);
  renderMessages();return;
 }
 if(d.type==='voice_error'){showNotice(d.message||'Voice service unavailable.',true);return;}
 if(d.type==='voice_level'){d.bands?.slice(0,20).forEach((value,i)=>document.body.style.setProperty('--voice-band-'+i,String(Math.max(0,Math.min(1,Number(value)||0)))));window.FEEDX_AUDIO_LEVEL=Math.max(0,Math.min(1,Number(d.level)||0));return;}
 if(d.type==='voice_telemetry'){
  $('#webVoiceAvailability').textContent=d.active ? d.message || 'Voice session active.' : d.message || '';
  $('#webVoiceResume').hidden=!d.resume;
  $('#webVoiceRefresh').hidden=d.active;
  const diagnostics=$('#webVoiceDiagnostics');
  diagnostics.replaceChildren();
  if(!d.report){diagnostics.textContent=d.active?'Diagnostics appear after the call.':'No call diagnostics yet.';return;}
  for(const line of d.report.metrics){const p=document.createElement('p');p.textContent=line;diagnostics.append(p);}
  const events=document.createElement('ol');
  for(const line of d.report.events){const li=document.createElement('li');li.textContent=line;events.append(li);}
  if(events.children.length)diagnostics.append(events);
  return;
 }
 if(d.type==='voice_state'){
  document.body.dataset.voiceState=d.state;
  const states={reconnecting:'thinking',connecting:'thinking',ending:'idle',suspended:'idle',interrupted:'listening',listening:'listening',transcribing:'thinking',executing:'executing',speaking:'speaking',error:'error'};window.FEEDX_AUDIO_LEVEL=0;if(states[d.state])setState(states[d.state]);else if(!activeRequest)setState('idle');return;}
 if(d.request_id!==activeRequest)return;
 if(d.type==='state'&&d.state==='executing'){activity(activeRequest,'executing',{factory:true,at:Date.now()});setState('executing');showNotice('Reading authorized Factory Finished Goods…');}
 if(d.type==='state'&&d.state==='thinking'){activity(activeRequest,'processing',{at:Date.now(),prompt:currentSession.messages.find(m=>m.request_id===activeRequest)?.text});setState('thinking');showNotice('Thinking…');}
 if(d.type==='result'&&typeof d.reply==='string'){activity(activeRequest,'complete',{factory:Boolean(d.tool_state),evidence:d.evidence,started:Date.parse(d.created_at),at:Date.parse(d.finished_at)});
  if(d.tool_state==='failed')activity(activeRequest,'failed',{operation:'text-read'});
  currentSession.messages.push({role:'assistant',text:d.reply.slice(0,3000),request_id:activeRequest,evidence:d.evidence,time:d.finished_at,usage:d.usage});const prompt=currentSession.messages.find(m=>m.request_id===activeRequest&&m.role==='user');if(prompt&&d.created_at)prompt.time=d.created_at;activeRequest='';renderMessages();setState('idle');showNotice(d.evidence?'Response received · verified read evidence attached.':'Response received.');
 }
});
// The renderer is unchanged; error is a non-speaking, idle-shaped visual state.
STATES.executing=STATES.thinking;STATE_LABEL.executing='Executing · read only';
STATES.error=STATES.idle;STATE_LABEL.error='Error';
if(parent!==window)request('ready');

// 2026-11-04: resize clears WebGL buffers; repaint the frozen scene without advancing time.
addEventListener('resize',()=>{if(window.FEEDX_VISUAL_PAUSED&&!document.hidden)requestAnimationFrame(()=>composer.render());});
