import { voiceOptions } from './realtimeVoice.js';
import { useRef } from 'react';
import { ArrowLeft, Download, Maximize2, Minimize2 } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import useNetworkFullscreen from '../operations-network/useNetworkFullscreen.js';
import { ASSISTANT_STAGING_ALLOWED } from './assistantEnvironment.js';
import useAssistantBridge from './useAssistantBridge.js';
import './aiAssistant.css';

export default function AiAssistantPage({ ui, auth }) {
  const root = useRef(null), frame = useRef(null);
  const {voiceState,voiceRef,realtimeState,realtimeRef}=useAssistantBridge(frame, ASSISTANT_STAGING_ALLOWED ? auth?.user?.id : null);
  const {provider,voice:preferredVoice}=realtimeState.voiceDefault||{provider:'render'};
  const realtimeSelected = Object.hasOwn(voiceOptions, provider);
  const realtimeAvailable = realtimeState.available?.[provider];
  const { fullscreen, notice, toggleFullscreen } = useNetworkFullscreen(root);
  return <section ref={root} className={`assistant-page${fullscreen ? ' assistant-fullscreen' : ''}`}>
    <PageHeader title="AI Assistant" description="Your immersive FeedX conversation space. Services connect only when independently authorized."
      actions={<><button type="button" className="btn-ghost" onClick={() => ui?.returnFromNetwork?.()}><ArrowLeft size={15} /> Back to workspace</button>
        <a className="btn-ghost" href="/open-source/jarvis/source.zip" download><Download size={15} /> HUD source &amp; license</a>
        <button type="button" className="btn-ghost" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullscreen ? 'Exit fullscreen' : 'Immersive view'}</button></>} />
    {notice && <p className="text-sm text-slate-600" role="status">{notice}</p>}
    {ASSISTANT_STAGING_ALLOWED&&realtimeSelected&&<div className="assistant-voice-bar" aria-label="Voice controls">
      <button type="button" className="btn-secondary" disabled={!realtimeAvailable&&!realtimeState.active} onClick={()=>realtimeState.active?realtimeRef.current?.stop():realtimeRef.current?.start(provider,voiceOptions[provider].includes(preferredVoice)?preferredVoice:voiceOptions[provider][0])}>{realtimeState.active?'End voice':'Start voice'}</button>
      {realtimeState.state==='playback_blocked'&&<button type="button" className="btn-ghost" onClick={()=>realtimeRef.current?.resume()}>Resume audio</button>}
      <span role="status">{realtimeState.message||(!realtimeAvailable?'Selected voice provider is unavailable. Choose a provider in AI Integrations.':null)||({connecting:'Connecting…',listening:'Listening',thinking:'Processing…',executing:'Reading Factory Finished Goods…',speaking:'Speaking'})[realtimeState.state]||(provider==='grok'?'Grok Voice':'OpenAI Realtime')+' · context lasts for this call'}</span>
      {!realtimeState.active&&realtimeState.report?.durationMs>0&&<details><summary>Last call measurements</summary>
        <p>Call: {Math.round(realtimeState.report.durationMs/1000)} s · First audio signal: {realtimeState.report.firstAudioMs==null?'unavailable':realtimeState.report.firstAudioMs+' ms'} · {realtimeState.report.usageReported?'Audio tokens: '+realtimeState.report.inputAudio+' in / '+realtimeState.report.outputAudio+' out':'Provider token usage unavailable'}</p>
      </details>}
    </div>}
    {ASSISTANT_STAGING_ALLOWED&&!realtimeSelected&&<div className="assistant-voice-bar" aria-label="Voice controls"><button type="button" className="btn-secondary" disabled={!voiceState.stt} onClick={()=>voiceState.state==='listening'?voiceRef.current?.finish():void voiceRef.current?.start()}>{voiceState.state==='listening'?'Finish speaking':'Talk'}</button><label><input type="checkbox" checked={voiceState.output} disabled={!voiceState.tts} onChange={e=>voiceRef.current?.setOutput(e.target.checked)}/> Voice replies</label>{voiceState.state==='playback_blocked'&&<button className="btn-secondary" type="button" onClick={()=>voiceRef.current?.play()}>Play voice</button>}<button type="button" className="btn-ghost" disabled={voiceState.state==='idle'} onClick={()=>voiceRef.current?.stop()}>Stop audio</button><span role="status">{voiceState.stt?voiceState.state==='idle'?'Push to talk · audio is not retained':voiceState.state:'Whisper / Kokoro voice unavailable · runtime not connected'}</span></div>}
    {ASSISTANT_STAGING_ALLOWED ? <iframe ref={frame} className="assistant-frame" title="FeedX AI Assistant — isolated Jarvis conversation HUD" src="/open-source/jarvis/index.html" sandbox="allow-scripts allow-downloads" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      : <div role="status" className="rounded-xl border p-6">AI Assistant is available on canonical Staging only. No services are connected.</div>}
  </section>;
}
