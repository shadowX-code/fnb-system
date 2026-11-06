import VoiceUsage from './VoiceUsage.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import { voiceOptions } from './realtimeVoice.js';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, AudioLines, Download, History, Brain, Plus, Maximize2, Mic, Minimize2, Square } from 'lucide-react';
import { HistoryDrawer, MemoryDrawer } from './AssistantDrawers.jsx';
import useNetworkFullscreen from '../operations-network/useNetworkFullscreen.js';
import { ASSISTANT_STAGING_ALLOWED } from './assistantEnvironment.js';
import useAssistantBridge from './useAssistantBridge.js';
import './aiAssistant.css';

export default function AiAssistantPage({ ui, auth }) {
  const root = useRef(null), frame = useRef(null);
  const {realtimeState,realtimeRef,refreshAvailability,setHudView,thread,threadAction,renameThread,textReady}=useAssistantBridge(frame, ASSISTANT_STAGING_ALLOWED ? auth?.user?.id : null);
  const {provider,voice:preferredVoice}=realtimeState.voiceDefault||{};
  const realtimeSelected = Object.hasOwn(voiceOptions, provider);
  const realtimeAvailable = realtimeState.available?.[provider];
  const { fullscreen, notice, toggleFullscreen } = useNetworkFullscreen(root, { native: false });
  useEffect(()=>setHudView(fullscreen),[fullscreen,setHudView]);
  const [drawer,setDrawer]=useState(null),[threadError,setThreadError]=useState('');
  const voiceLocked=realtimeState.active||realtimeState.state==='connecting';
  const threadControls=<>
    <button type="button" className="btn-ghost" aria-label="History" onClick={()=>setDrawer('history')}><History size={16}/> History</button>
    <button type="button" className="btn-ghost" onClick={()=>setDrawer('memory')}><Brain size={16}/> <span className="assistant-memory-label">Personal memory</span></button>
  </>;
  async function newThread(){
    setThreadError('');
    try{await threadAction('new');}catch(cause){setThreadError(cause.message);}
  }
  const [hudTime,setHudTime]=useState(()=>new Date());
  useEffect(()=>{
    if(!fullscreen)return;
    setHudTime(new Date());
    const clock=setInterval(()=>setHudTime(new Date()),15000);
    return ()=>clearInterval(clock);
  },[fullscreen]);
  const liveSignal = ['listening', 'thinking', 'executing', 'speaking'].includes(realtimeState.state);
  return <section ref={root} className={`assistant-page${fullscreen ? ' assistant-fullscreen' : ''}`}>
    {!fullscreen&&<header className="assistant-standard-header">
      <div className="assistant-thread-heading">
        <button type="button" className="btn-ghost" aria-label="Back to workspace" onClick={()=>ui?.returnFromNetwork?.()}><ArrowLeft size={16}/></button>
        <div><h1 title={thread?.title||'AI Assistant'}>{thread?.title||'AI Assistant'}</h1><p><span aria-hidden="true" data-ready={textReady===true}/> AI Assistant · {voiceLocked?'Voice session active':textReady===true?'Text ready':textReady===false?'Text unavailable':'Checking services'}</p></div>
      </div>
      <nav aria-label="Conversation controls" className="assistant-header-actions">
        {threadControls}
        <button type="button" className="btn-secondary" disabled={voiceLocked} title={voiceLocked?'End voice to start a new conversation':undefined} onClick={newThread}><Plus size={16}/> New conversation</button>
        <button type="button" className="btn-ghost" onClick={toggleFullscreen}><Maximize2 size={15}/> Immersive view</button>
        <a className="btn-ghost assistant-source-link" href="/open-source/jarvis/source.zip" download aria-label="HUD source & license"><Download size={15}/></a>
      </nav>
    </header>}
    {fullscreen&&<header className="assistant-hud-header">
      <div className="assistant-hud-brand"><svg className="assistant-hud-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M18 3v30M5 10l26 16M5 26l26-16M18 3 31 10v16L18 33 5 26V10Z" stroke="currentColor" strokeWidth="1.1"/><path d="m18 10 7 8-7 8-7-8z" fill="currentColor" fillOpacity=".28" stroke="currentColor"/><circle cx="18" cy="18" r="2" fill="currentColor"/></svg><div><strong>FeedX / AI Assistant</strong><small>F&B Operations Intelligence</small></div></div>
      <div className="assistant-hud-clock"><time dateTime={hudTime.toISOString()}>{hudTime.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false})}</time><small>{hudTime.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})}</small></div>
      <div className="assistant-hud-provider"><AudioLines size={17} aria-hidden="true"/><span>{provider==='openai'?'OpenAI Realtime SDK':provider==='grok'?'Grok Voice':'Voice unavailable'}</span>{provider==='openai'&&<small className="assistant-hud-model"><span>Model</span>gpt-realtime-2.1-mini</small>}<span className="assistant-hud-status" data-ready={realtimeState.active||Boolean(realtimeAvailable&&!(provider==='openai'&&realtimeState.voicePolicy?.state!=='available'))}>{realtimeState.active?'In session':realtimeState.voicePolicy?.state!=='available'&&provider==='openai'?'Unavailable':realtimeAvailable?'Ready':'Unavailable'}</span><a href="/open-source/jarvis/source.zip" download className="btn-ghost" aria-label="HUD source and license"><Download size={15}/></a></div>
      <nav className="assistant-hud-thread-actions" aria-label="Conversation controls">{threadControls}</nav>
    </header>}
    {threadError&&<p className="assistant-thread-error" role="alert">{threadError}</p>}
    {notice && <p className="text-sm text-slate-600" role="status">{notice}</p>}
    <div className="assistant-stage" data-voice-state={realtimeState.state}>
    {ASSISTANT_STAGING_ALLOWED ? <iframe ref={frame} onLoad={()=>setHudView(fullscreen)} className="assistant-frame" title="FeedX AI Assistant — isolated Jarvis conversation HUD" src="/open-source/jarvis/index.html" sandbox="allow-scripts allow-downloads" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      : <div role="status" className="rounded-xl border p-6">AI Assistant is available on canonical Staging only. No services are connected.</div>}
    {ASSISTANT_STAGING_ALLOWED&&<div className="assistant-voice-dock" aria-label="Voice controls" data-signal={liveSignal}>
      <svg className="assistant-dock-wave" viewBox="0 0 220 50" aria-hidden="true"><path d="M0 25h220"/><path d="M0 25Q20 26 32 25T55 25Q66 15 76 25T100 25Q112 8 122 25T145 25Q158 16 169 25T193 25Q204 25 220 25"/></svg>
      <button type="button" className="btn-secondary assistant-mic-control" disabled={(!realtimeSelected||!realtimeAvailable||(realtimeState.sdkVoice&&realtimeState.voicePolicy?.state!=='available'))&&!realtimeState.active} onClick={()=>realtimeState.active?realtimeRef.current?.stop():realtimeRef.current?.start(provider,voiceOptions[provider].includes(preferredVoice)?preferredVoice:voiceOptions[provider][0])}>{realtimeState.active?<Square size={16} aria-hidden="true"/>:<Mic size={17} aria-hidden="true"/>}<span>{realtimeState.active?'End voice':realtimeState.sdkVoice&&realtimeState.voicePolicy?.state==='approval_required'?'Approval required':realtimeState.sdkVoice&&realtimeState.voicePolicy?.state!=='available'?({disabled:'Voice disabled',active_elsewhere:'Session active',capacity:'Voice busy',daily_limit:'Daily limit reached'})[realtimeState.voicePolicy?.state]||'Voice unavailable':'Start voice'}</span></button>
<p className="assistant-voice-state" role="status">{({idle:'Ready',connecting:'Connecting…',listening:'Listening',thinking:'Thinking',executing:'Reading Factory',speaking:'Speaking',interrupted:'Interrupted · listening',error:'Connection error',playback_blocked:'Tap to resume audio'})[realtimeState.state]||'Ready'}</p>
      {realtimeState.state==='playback_blocked'&&<button type="button" className="btn-ghost" onClick={()=>realtimeRef.current?.resume()}>Resume audio</button>}
      <details className="assistant-voice-availability"><summary>Voice status</summary><span role="status">{realtimeState.message||(!realtimeState.active&&realtimeState.sdkVoice&&realtimeAvailable?({available:'Available for authorized Staging testing. Up to '+(realtimeState.voicePolicy?.maximum_seconds||180)+' seconds per session. Provider charges and rate limits apply.',disabled:'Voice is disabled by an administrator. Text remains available.',active_elsewhere:'Another session is active or awaiting cleanup. End it before starting Voice here.',capacity:'Voice capacity is currently busy. Try again after a session ends.',daily_limit:'The configured daily limit was reached. It resets at midnight UTC.',approval_required:'The configured voice policy requires approval.'})[realtimeState.voicePolicy?.state]||'Checking voice policy…':null)||(!realtimeAvailable?'Selected voice provider is unavailable. Choose a provider in AI Integrations.':null)||({connecting:'Connecting…',listening:'Listening',thinking:'Processing…',executing:'Reading Factory Finished Goods…',speaking:'Speaking',interrupted:'Interrupted · listening'})[realtimeState.state]||(provider==='grok'?'Grok Voice':'OpenAI Realtime SDK')+' · context lasts for this call'}</span><button type="button" className="btn-ghost" onClick={()=>setDrawer('usage')}>Usage &amp; limits</button></details>
      {!realtimeState.active&&<button type="button" className="btn-ghost assistant-voice-refresh" onClick={refreshAvailability}>Check availability</button>}

      {!realtimeState.active&&realtimeState.report?.durationMs>0&&<details><summary>Session details</summary>
        <p>Call: {Math.round(realtimeState.report.durationMs/1000)} s · First audio signal: {realtimeState.report.firstAudioMs==null?'unavailable':realtimeState.report.firstAudioMs+' ms'} · {realtimeState.report.usageReported?'Audio tokens: '+realtimeState.report.inputAudio+' in / '+realtimeState.report.outputAudio+' out':'Provider token usage unavailable'}</p><p>Speech starts during playback: {realtimeState.report.startsDuringPlayback} · Committed speech turns: {realtimeState.report.detectedTurns}</p><ol className="max-h-48 overflow-auto">{realtimeState.report.events?.map((event,index)=><li key={index}>{event.ms} ms · {event.event}{event.turn?' · turn '+event.turn:''}{event.response?' · response '+event.response:''}{event.reason?' · '+event.reason:''}</li>)}</ol>
      </details>}

    </div>}
    {fullscreen&&<button type="button" className="btn-ghost assistant-view-switch" onClick={toggleFullscreen}><Minimize2 size={15}/> Standard view</button>}
    </div>
    {drawer==='history'&&<HistoryDrawer close={()=>setDrawer(null)} thread={thread} locked={voiceLocked} act={threadAction} rename={renameThread}/>}
    {drawer==='usage'&&<Drawer title="Voice usage" description="Environment availability and session safety" width="sm" onClose={()=>setDrawer(null)} className="assistant-drawer"><VoiceUsage onSaved={refreshAvailability}/></Drawer>}
    {drawer==='memory'&&<MemoryDrawer close={()=>setDrawer(null)} voiceActive={voiceLocked}/>}

  </section>;
}
