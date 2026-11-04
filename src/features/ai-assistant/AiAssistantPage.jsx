import { voiceOptions } from './realtimeVoice.js';
import { useEffect, useRef } from 'react';
import { ArrowLeft, AudioLines, Download, Maximize2, Mic, Minimize2, Square } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import useNetworkFullscreen from '../operations-network/useNetworkFullscreen.js';
import { ASSISTANT_STAGING_ALLOWED } from './assistantEnvironment.js';
import useAssistantBridge from './useAssistantBridge.js';
import './aiAssistant.css';

export default function AiAssistantPage({ ui, auth }) {
  const root = useRef(null), frame = useRef(null);
  const {realtimeState,realtimeRef,setHudView}=useAssistantBridge(frame, ASSISTANT_STAGING_ALLOWED ? auth?.user?.id : null);
  const {provider,voice:preferredVoice}=realtimeState.voiceDefault||{};
  const realtimeSelected = Object.hasOwn(voiceOptions, provider);
  const realtimeAvailable = realtimeState.available?.[provider];
  const { fullscreen, notice, toggleFullscreen } = useNetworkFullscreen(root);
  useEffect(()=>setHudView(fullscreen),[fullscreen,setHudView]);
  return <section ref={root} className={`assistant-page${fullscreen ? ' assistant-fullscreen' : ''}`}>
    {!fullscreen&&<PageHeader title="AI Assistant" description="Your immersive FeedX conversation space. Services connect only when independently authorized."
      actions={<><button type="button" className="btn-ghost" onClick={() => ui?.returnFromNetwork?.()}><ArrowLeft size={15} /> Back to workspace</button>
        <a className="btn-ghost" href="/open-source/jarvis/source.zip" download><Download size={15} /> HUD source &amp; license</a>
        <button type="button" className="btn-ghost" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullscreen ? 'Exit fullscreen' : 'Immersive view'}</button></>} />}
    {fullscreen&&<header className="assistant-hud-header"><AudioLines size={21} aria-hidden="true"/><div><strong>FeedX / AI Assistant</strong><small>F&B Operations Intelligence</small></div><span>{provider==='openai'?'OpenAI Realtime SDK':provider==='grok'?'Grok Voice':'Voice unavailable'}</span></header>}
    {notice && <p className="text-sm text-slate-600" role="status">{notice}</p>}
    {ASSISTANT_STAGING_ALLOWED&&<div className="assistant-voice-bar" aria-label="Voice controls">
      <button type="button" className="btn-secondary" disabled={(!realtimeSelected||!realtimeAvailable||(realtimeState.sdkVoice&&realtimeState.sdkRemaining===0))&&!realtimeState.active} onClick={()=>realtimeState.active?realtimeRef.current?.stop():realtimeRef.current?.start(provider,voiceOptions[provider].includes(preferredVoice)?preferredVoice:voiceOptions[provider][0])}>{realtimeState.active?<Square size={16} aria-hidden="true"/>:<Mic size={17} aria-hidden="true"/>}{realtimeState.active?'End voice':'Start voice'}</button>
      {realtimeState.state==='playback_blocked'&&<button type="button" className="btn-ghost" onClick={()=>realtimeRef.current?.resume()}>Resume audio</button>}
      <span role="status">{realtimeState.message||(realtimeState.sdkVoice&&realtimeState.sdkRemaining===0?'OpenAI Realtime SDK · Staging voice allowance used':null)||(!realtimeAvailable?'Selected voice provider is unavailable. Choose a provider in AI Integrations.':null)||({connecting:'Connecting…',listening:'Listening',thinking:'Processing…',executing:'Reading Factory Finished Goods…',speaking:'Speaking',interrupted:'Interrupted · listening'})[realtimeState.state]||(provider==='grok'?'Grok Voice':'OpenAI Realtime SDK')+' · context lasts for this call'}</span>
      {!realtimeState.active&&realtimeState.report?.durationMs>0&&<details><summary>Session details</summary>
        <p>Call: {Math.round(realtimeState.report.durationMs/1000)} s · First audio signal: {realtimeState.report.firstAudioMs==null?'unavailable':realtimeState.report.firstAudioMs+' ms'} · {realtimeState.report.usageReported?'Audio tokens: '+realtimeState.report.inputAudio+' in / '+realtimeState.report.outputAudio+' out':'Provider token usage unavailable'}</p><p>Speech starts during playback: {realtimeState.report.startsDuringPlayback} · Committed speech turns: {realtimeState.report.detectedTurns}</p><ol className="max-h-48 overflow-auto">{realtimeState.report.events?.map((event,index)=><li key={index}>{event.ms} ms · {event.event}{event.turn?' · turn '+event.turn:''}{event.response?' · response '+event.response:''}{event.reason?' · '+event.reason:''}</li>)}</ol>
      </details>}
      {fullscreen&&<button type="button" className="btn-ghost assistant-view-switch" onClick={toggleFullscreen}><Minimize2 size={15}/> Standard view</button>}
    </div>}
    {ASSISTANT_STAGING_ALLOWED ? <iframe ref={frame} onLoad={()=>setHudView(fullscreen)} className="assistant-frame" title="FeedX AI Assistant — isolated Jarvis conversation HUD" src="/open-source/jarvis/index.html" sandbox="allow-scripts allow-downloads" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      : <div role="status" className="rounded-xl border p-6">AI Assistant is available on canonical Staging only. No services are connected.</div>}
  </section>;
}
