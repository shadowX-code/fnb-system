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
function messagesForTurn(t){
 const status={voice_interrupted:'Interrupted — this reply was stopped before completion',voice_transcript_unavailable:'Assistant transcript unavailable',voice_unfinished:'Response unfinished',voice_failed:'Response failed'};
 return [{role:'user',text:t.prompt,request_id:t.request_id,voice:t.voice,time:t.created_at},...(t.state==='completed'&&t.reply?
 [{role:'assistant',text:t.reply,request_id:t.request_id,evidence:t.evidence,voice:t.voice,time:t.finished_at,usage:{input_tokens:t.input_tokens,output_tokens:t.output_tokens,model:t.model,context:t.context_usage}}]:
 t.voice&&status[t.error_code]?[{role:'assistant',text:status[t.error_code],outcome:t.error_code,request_id:t.request_id,voice:true,evidence:t.evidence,time:t.finished_at}]:[])];
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
const voiceWave=`<svg class="web-signal" viewBox="0 0 240 40" aria-hidden="true">
 <path class="web-wave-baseline" d="M0 20h240"/>
 <path class="web-wave-echo" d="M0 20Q21 17 36 21T63 20Q76 14 88 21T111 22Q125 12 139 21T162 22Q173 15 184 21T205 20Q222 20 240 20"/>
 <path class="web-wave-echo" d="M0 20Q19 22 33 19T60 22Q71 26 84 19T108 20Q122 29 135 20T160 19Q172 26 183 20T207 19Q223 22 240 20"/>
 <path class="web-wave-main" d="M0 20C15 20 21 24 31 20S47 17 55 21S70 29 81 18S96 9 106 20S122 30 134 17S150 8 161 20S176 27 188 20S203 18 212 20S226 20 240 20"/>
</svg>`;
const activityWave=`<svg class="web-event-wave" viewBox="0 0 80 24" aria-hidden="true"><path d="M0 21h8l4-2 5 1 5-3 5-5 3 1 5-8 4 4 4 5 4-2 5 5 6 2 6 1h16v2H0z"/></svg>`;

const web=document.createElement('section');web.id='assistantWeb';
web.innerHTML=`<div class="web-core-caption"><span class="web-status-dot"></span><strong>Visual ready</strong><p>Original Jarvis Core · no active AI service</p><button type="button" id="webPause">Pause motion</button></div>
<div class="web-reticle" aria-hidden="true"><i></i><b></b><span></span></div>
<div class="web-core-name" aria-hidden="true">J A R V I S<small>FeedX AI Core</small></div>
<aside class="web-telemetry" aria-label="Session telemetry">
<section class="web-hud-panel"><h2>Agent activity</h2><ol id="webActivity"><li class="web-activity-idle">Waiting for a request</li></ol></section>
<section class="web-hud-panel"><h2>Current session</h2><div class="web-session-body"><div class="web-session-ring"><strong id="webTurnCount">0</strong><span>Turns</span></div><dl id="webSessionFacts"></dl></div></section>
<section class="web-hud-panel"><h2>Voice state</h2><div class="web-voice-state"><p id="webLiveState">Idle</p>${voiceWave}</div></section>
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
$('.web-dock').appendChild($('#webComposer'));
input.setAttribute('aria-label','Message AI Assistant');input.placeholder='Ask FeedX…';input.maxLength=2000;
$('#mic').setAttribute('aria-label','Microphone unavailable');$('#mic').setAttribute('aria-disabled','true');$('#mic').title='No authorized speech recognition service is connected';
const submit=document.createElement('button');submit.type='button';submit.id='webSend';submit.textContent='Send';$('#form').appendChild(submit);
function showNotice(text,error=false){notice.textContent=text;notice.setAttribute('role',error?'alert':'status');notice.dataset.error=String(error);}
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
const activityStyles={
 'Understanding':['understanding','understand','Request accepted'],
 'Processing':['processing','thinking','Preparing a response'],
 'Executing':['factory','factory','Reading Finished Goods'],
 'Factory evidence saved':['factory','factory','Authorized Finished Goods read'],
 'Speaking':['speaking','speech','Assistant audio playing'],
 'Completed':['complete','done','Reply available in Conversation'],
 'Interrupted':['interrupted','pause','Response interrupted'],
 'Error':['error','alert','See Conversation for details'],
};
function activity(label){
 const list=$('#webActivity'),style=activityStyles[label];
 if(!style||list.lastElementChild?.dataset.label===label)return;
 if(list.firstElementChild?.classList.contains('web-activity-idle'))list.replaceChildren();
 const [stage,icon,detail]=style;
 const item=document.createElement('li');
 item.dataset.stage=stage;item.dataset.label=label;
 const marker=document.createElement('span'),copy=document.createElement('span'),caption=document.createElement('small');
 marker.className='web-event-node';marker.setAttribute('aria-hidden','true');marker.innerHTML=hudIcon(icon);
 copy.textContent=label;caption.textContent=detail;copy.append(caption);item.append(marker,copy);item.insertAdjacentHTML('beforeend',activityWave);list.append(item);
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
// Provider totals are measured; context and USD are explicitly estimates, never invoices.
function appendResponseDetails(item,message){
 if(message.role!=='assistant')return;
 const usage=message.usage,context=usage?.context;
 if(!usage&&!message.outcome)return;
 const details=document.createElement('details'),label=document.createElement('summary');
 details.className='web-response-details';label.textContent=message.outcome?'Reply status':'Response details';details.append(label);
 const note=document.createElement('p');
 if(message.outcome){note.textContent=message.outcome==='voice_interrupted'?'The spoken reply was interrupted. This is not a completed answer.':'No completed assistant transcript is available.';details.append(note);}
 if(Number.isInteger(usage?.input_tokens)&&Number.isInteger(usage?.output_tokens)){
  const tokens=document.createElement('p');tokens.textContent=`Provider-reported tokens: ${usage.input_tokens} in / ${usage.output_tokens} out`;details.append(tokens);
  if(Number.isFinite(context?.estimated_usd)){const cost=document.createElement('p');cost.textContent=`Estimated text cost: US$${context.estimated_usd.toFixed(6)} · uncached list rates (${context.pricing_version}); not an invoice`;details.append(cost);}
 }
 if(context){const info=document.createElement('p');info.textContent=`Context estimate: ${context.estimated_context_tokens} / ${context.budget_tokens} tokens · ${context.recent_turns} recent turns · ${context.summarized_turns} older turns indexed (${context.version}). Original messages remain in History.`;details.append(info);
  for(const source of context.recall_sources||[]){const button=document.createElement('button');button.type='button';button.textContent=`History source: ${source.title} · turn ${source.seq}`;button.onclick=()=>request('history',{session_id:source.session_id});details.append(button);}
 }
 if(details.children.length>1)item.append(details);
}
function renderMessages({prepend=false,reset=false}={}){const previousHeight=messageList.scrollHeight,previousTop=messageList.scrollTop,nearBottom=previousHeight-previousTop-messageList.clientHeight<80;renderIntelligence();older.hidden=!hasOlder;older.disabled=false;$('#webStop').hidden=!activeRequest;messageList.replaceChildren();if(!currentSession.messages.length){const empty=document.createElement('li');empty.className='web-empty';empty.textContent=connected&&!currentSession.id?'What would you like to work on? Ask a question here, or open a private conversation from History.':'Start with a question. Your request will appear here; responses require an authorized model connection.';messageList.appendChild(empty);}for(const message of currentSession.messages){const item=document.createElement('li');item.dataset.speaker=message.role;if(message.outcome)item.dataset.outcome=message.outcome;const avatar=document.createElement('span');avatar.className='web-message-avatar';avatar.innerHTML=hudIcon(message.role==='assistant'?'spark':message.voice?'speech':'understand');const label=document.createElement('strong');label.textContent=(message.role==='assistant'?'Assistant':'You')+(message.voice?' · Voice':'');const text=document.createElement('p');for(const part of message.text.split(/(\*\*[^*]+\*\*)/g)){if(part.startsWith('**')&&part.endsWith('**')){const bold=document.createElement('strong');bold.textContent=part.slice(2,-2);text.append(bold);}else text.append(document.createTextNode(part));}item.append(avatar,label);
 if(message.time&&Number.isFinite(Date.parse(message.time))){const time=document.createElement('time');time.dateTime=message.time;time.textContent=new Date(message.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});item.append(time);}
 item.append(text);if(message.evidence?.capability==='read_factory_finished_goods'){const evidence=document.createElement('div');evidence.className='web-evidence';const badge=document.createElement('span');badge.className='web-evidence-icon';badge.innerHTML=hudIcon('factory');const link=document.createElement('a');link.href='https://fnb-system-staging.vercel.app/factory/warehouse/finished-goods';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Factory · Finished Goods ↗';const stamp=document.createElement('span');stamp.textContent=`${message.evidence.scope} · ${message.evidence.as_of} · ${message.evidence.returned}/${message.evidence.total_matching} matches${Number.isInteger(message.evidence.unknown_minimum_count)?' · '+message.evidence.unknown_minimum_count+' unknown minimums':''}`;const details=document.createElement('details'),summary=document.createElement('summary'),note=document.createElement('p');summary.textContent='Read evidence';note.textContent=message.evidence.limitations;details.append(summary,note);evidence.append(badge,link,stamp,details);item.append(evidence);}appendResponseDetails(item,message);messageList.appendChild(item);}messageList.scrollTop=prepend?previousTop+messageList.scrollHeight-previousHeight:reset||nearBottom?messageList.scrollHeight:previousTop;}
// Same request/session identity boundary as the pilot. No remote engine is configured.
let handle=function(text){text=text.trim();if(!text)return;if(document.body.dataset.voiceLocked==='true'){showNotice('End voice before sending a text message.',true);return;}if(activeRequest){showNotice('Stop the current response before sending another request.',true);return;}
 $('#webRetry').hidden=true;activeRequest=crypto.randomUUID();currentSession.messages.push({request_id:activeRequest,role:'user',text:text.slice(0,2000)});renderMessages();
 if(connected){parent.postMessage({protocol,action:'send',request_id:activeRequest,session_id:currentSession.id,text:text.slice(0,2000)},hostOrigin);showNotice('Submitting request…');}
 else{activeRequest='';setState('idle');showNotice('Language model unavailable. Your request was not sent and no AI answer was generated.',true);}
};
// Sandboxed frames deliberately disallow form submission; use explicit local actions.
function sendLocalRequest(){if(document.body.dataset.voiceLocked==='true'){handle(input.value);return;}handle(input.value);input.value='';}
submit.onclick=sendLocalRequest;
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();sendLocalRequest();}});
$('#form').addEventListener('submit',event=>event.preventDefault());
$('#webNew').onclick=()=>{if(connected){request('new');return;}activeRequest='';captureEpoch++;currentSession={id:crypto.randomUUID(),messages:[]};input.value='';renderMessages();setState('idle');showNotice('New conversation. No model is connected; history stays in this tab.');input.focus();};
older.onclick=()=>{older.disabled=true;request('older');};
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
  input.readOnly=d.active===true;
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
  currentSession.messages.unshift(...d.turns.filter(turn=>!existing.has(turn.request_id)).flatMap(messagesForTurn));hasOlder=d.has_more===true;
  renderMessages({prepend:true});return;
 }
 if(d.type==='history_error'){older.disabled=false;showNotice(d.message||'Older messages are unavailable.',true);return;}
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
  $('#webLiveState').textContent=({connecting:'Connecting',listening:'Listening',transcribing:'Thinking',executing:'Executing',speaking:'Speaking',interrupted:'Interrupted',error:'Error',playback_blocked:'Playback blocked'})[d.state]||'Idle';
  activity(({transcribing:'Processing',executing:'Executing',speaking:'Speaking',error:'Error'})[d.state]);
  const states={interrupted:'listening',listening:'listening',transcribing:'thinking',executing:'executing',speaking:'speaking',error:'error'};window.FEEDX_AUDIO_LEVEL=0;if(states[d.state])setState(states[d.state]);else if(!activeRequest)setState('idle');return;}
 if(d.request_id!==activeRequest)return;
 if(d.type==='state'&&d.state==='executing'){activity('Executing');setState('executing');showNotice('Reading authorized Factory Finished Goods…');}
 if(d.type==='state'&&d.state==='thinking'){activity('Understanding');setState('thinking');showNotice('Thinking…');}
 if(d.type==='result'&&typeof d.reply==='string'){activity('Completed');
  currentSession.messages.push({role:'assistant',text:d.reply.slice(0,3000),request_id:activeRequest,evidence:d.evidence,time:d.finished_at,usage:d.usage});const prompt=currentSession.messages.find(m=>m.request_id===activeRequest&&m.role==='user');if(prompt&&d.created_at)prompt.time=d.created_at;activeRequest='';renderMessages();setState('idle');showNotice(d.evidence?'Response received · verified read evidence attached.':'Response received.');
 }
});
// The renderer is unchanged; error is a non-speaking, idle-shaped visual state.
STATES.executing=STATES.thinking;STATE_LABEL.executing='Executing · read only';
STATES.error=STATES.idle;STATE_LABEL.error='Error';
if(parent!==window)request('ready');

// 2026-11-04: resize clears WebGL buffers; repaint the frozen scene without advancing time.
addEventListener('resize',()=>{if(window.FEEDX_VISUAL_PAUSED&&!document.hidden)requestAnimationFrame(()=>composer.render());});
