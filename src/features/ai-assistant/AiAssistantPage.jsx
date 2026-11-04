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
  const {realtimeState,realtimeRef,setHudView,thread,threadAction,renameThread,textReady}=useAssistantBridge(frame, ASSISTANT_STAGING_ALLOWED ? auth?.user?.id : null);
  const {provider,voice:preferredVoice}=realtimeState.voiceDefault||{};
  const realtimeSelected = Object.hasOwn(voiceOptions, provider);
  const realtimeAvailable = realtimeState.available?.[provider];
  const { fullscreen, notice, toggleFullscreen } = useNetworkFullscreen(root);
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
  return <section ref={root} onKeyDownCapture={event=>{if(drawer&&event.key==='Escape'){event.preventDefault();setDrawer(null);}}} className={`assistant-page${fullscreen ? ' assistant-fullscreen' : ''}`}>
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
      <div className="assistant-hud-provider"><AudioLines size={17} aria-hidden="true"/><span>{provider==='openai'?'OpenAI Realtime SDK':provider==='grok'?'Grok Voice':'Voice unavailable'}</span>{provider==='openai'&&<small className="assistant-hud-model"><span>Model</span>gpt-realtime-2.1-mini</small>}<span className="assistant-hud-status" data-ready={realtimeState.active||Boolean(realtimeAvailable&&!(provider==='openai'&&realtimeState.sdkRemaining===0))}>{realtimeState.active?'In session':realtimeState.sdkRemaining===0&&provider==='openai'?'Allowance used':realtimeAvailable?'Ready':'Unavailable'}</span><a href="/open-source/jarvis/source.zip" download className="btn-ghost" aria-label="HUD source and license"><Download size={15}/></a></div>
      <nav className="assistant-hud-thread-actions" aria-label="Conversation controls">{threadControls}</nav>
    </header>}
    {threadError&&<p className="assistant-thread-error" role="alert">{threadError}</p>}
    {notice && <p className="text-sm text-slate-600" role="status">{notice}</p>}
    {ASSISTANT_STAGING_ALLOWED&&<div className="assistant-voice-bar" aria-label="Voice controls" data-signal={liveSignal}>
      {fullscreen&&<button type="button" className="btn-ghost assistant-view-switch" onClick={toggleFullscreen}><Minimize2 size={15}/> Standard view</button>}
      {fullscreen&&<span className="assistant-dock-signal" aria-hidden="true"/>}
      <button type="button" className="btn-secondary assistant-mic-control" disabled={(!thread||!realtimeSelected||!realtimeAvailable||(realtimeState.sdkVoice&&realtimeState.sdkRemaining===0))&&!realtimeState.active} onClick={()=>realtimeState.active?realtimeRef.current?.stop():realtimeRef.current?.start(provider,voiceOptions[provider].includes(preferredVoice)?preferredVoice:voiceOptions[provider][0])}>{realtimeState.active?<Square size={16} aria-hidden="true"/>:<Mic size={17} aria-hidden="true"/>}<span>{realtimeState.active?'End voice':'Start voice'}</span></button>
      {fullscreen&&<span className="assistant-dock-signal assistant-dock-signal-right" aria-hidden="true"/>}
      {realtimeState.state==='playback_blocked'&&<button type="button" className="btn-ghost" onClick={()=>realtimeRef.current?.resume()}>Resume audio</button>}
      <span role="status">{realtimeState.message||(realtimeState.sdkVoice&&realtimeState.sdkRemaining===0?'OpenAI Realtime SDK · Staging voice allowance used':null)||(!realtimeAvailable?'Selected voice provider is unavailable. Choose a provider in AI Integrations.':null)||({connecting:'Connecting…',listening:'Listening',thinking:'Processing…',executing:'Reading Factory Finished Goods…',speaking:'Speaking',interrupted:'Interrupted · listening'})[realtimeState.state]||(provider==='grok'?'Grok Voice':'OpenAI Realtime SDK')+' · context lasts for this call'}</span>
      {!realtimeState.active&&realtimeState.report?.durationMs>0&&<details><summary>Session details</summary>
        <p>Call: {Math.round(realtimeState.report.durationMs/1000)} s · First audio signal: {realtimeState.report.firstAudioMs==null?'unavailable':realtimeState.report.firstAudioMs+' ms'} · {realtimeState.report.usageReported?'Audio tokens: '+realtimeState.report.inputAudio+' in / '+realtimeState.report.outputAudio+' out':'Provider token usage unavailable'}</p><p>Speech starts during playback: {realtimeState.report.startsDuringPlayback} · Committed speech turns: {realtimeState.report.detectedTurns}</p><ol className="max-h-48 overflow-auto">{realtimeState.report.events?.map((event,index)=><li key={index}>{event.ms} ms · {event.event}{event.turn?' · turn '+event.turn:''}{event.response?' · response '+event.response:''}{event.reason?' · '+event.reason:''}</li>)}</ol>
      </details>}

    </div>}
    {drawer==='history'&&<HistoryDrawer close={()=>setDrawer(null)} thread={thread} locked={voiceLocked} act={threadAction} rename={renameThread}/>}
    {drawer==='memory'&&<MemoryDrawer close={()=>setDrawer(null)} voiceActive={voiceLocked}/>}
    {ASSISTANT_STAGING_ALLOWED ? <iframe ref={frame} onLoad={()=>setHudView(fullscreen)} className="assistant-frame" title="FeedX AI Assistant — isolated Jarvis conversation HUD" src="/open-source/jarvis/index.html" sandbox="allow-scripts allow-downloads" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      : <div role="status" className="rounded-xl border p-6">AI Assistant is available on canonical Staging only. No services are connected.</div>}
  </section>;
}
