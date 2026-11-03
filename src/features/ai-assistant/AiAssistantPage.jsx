import { useRef } from 'react';
import { ArrowLeft, Download, Maximize2, Minimize2 } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import useNetworkFullscreen from '../operations-network/useNetworkFullscreen.js';
import { ASSISTANT_STAGING_ALLOWED } from './assistantEnvironment.js';
import useAssistantBridge from './useAssistantBridge.js';
import './aiAssistant.css';

export default function AiAssistantPage({ ui, auth }) {
  const root = useRef(null), frame = useRef(null);
  useAssistantBridge(frame, ASSISTANT_STAGING_ALLOWED ? auth?.user?.id : null);
  const { fullscreen, notice, toggleFullscreen } = useNetworkFullscreen(root);
  return <section ref={root} className={`assistant-page${fullscreen ? ' assistant-fullscreen' : ''}`}>
    <PageHeader title="AI Assistant" description="Your immersive FeedX conversation space. Services connect only when independently authorized."
      actions={<><button type="button" className="btn-ghost" onClick={() => ui?.returnFromNetwork?.()}><ArrowLeft size={15} /> Back to workspace</button>
        <a className="btn-ghost" href="/open-source/jarvis/source.zip" download><Download size={15} /> HUD source &amp; license</a>
        <button type="button" className="btn-ghost" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{fullscreen ? 'Exit fullscreen' : 'Immersive view'}</button></>} />
    {notice && <p className="text-sm text-slate-600" role="status">{notice}</p>}
    {ASSISTANT_STAGING_ALLOWED ? <iframe ref={frame} className="assistant-frame" title="FeedX AI Assistant — isolated Jarvis conversation HUD" src="/open-source/jarvis/index.html" sandbox="allow-scripts allow-downloads" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      : <div role="status" className="rounded-xl border p-6">AI Assistant is available on canonical Staging only. No services are connected.</div>}
  </section>;
}
