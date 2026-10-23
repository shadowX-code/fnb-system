import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import {isVideoFormat} from './publishingMedia.js';
import { marketingService } from './marketingService.js';
const label = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const stamp = value => value ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(value)) : 'Unavailable';
const active = c => ['test_authorized', 'production_authorized'].includes(c.status) && Date.parse(c.expires_at) > Date.now();

export { default as MetaConnections } from './SocialAccounts.jsx';

export function PublishAuthorization({ content, onComplete }) {
  const auth = useAuth(), [connections, setConnections] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false),[videoEnabled,setVideoEnabled]=useState(false);
  const request = useRef(crypto.randomUUID()), lifetime = useRef(0);
  const variants=content.payload.variants.filter(v=>!content.channels||content.channels.some(c=>c.channel===v.channel&&['blocked','queued','retry'].includes(c.job_state)));
  useEffect(() => {
    let live = true; lifetime.current++;setConnections(null);setError('');setAccepted(false);
    if(!['scheduled','failed'].includes(content.status) || !auth.hasPermission('marketing_content.execute') || !auth.hasPermission('marketing_content.publish')) return () => { live = false;lifetime.current++; };
    Promise.all([marketingService.integrations(content.organization_id, content.brand_id, 'content'),variants.some(v=>v.channel==='facebook'&&isVideoFormat(v.format))?marketingService.metaConfiguration():Promise.resolve({})]).then(([data,config]) => { if (live){setConnections(data.connections);setVideoEnabled(config.facebook_video_execution_enabled===true);} }).catch(e => { if (live) setError(e.message); });
    return () => { live = false;lifetime.current++; };
  }, [content.id, content.revision, content.status, auth.user?.id]);
  if (!['scheduled','failed'].includes(content.status) || !auth.hasPermission('marketing_content.execute') || !auth.hasPermission('marketing_content.publish')) return null;
  const selected = variants.map(v => connections?.find(c => c.channel === v.channel && active(c) && c.capabilities.publishing && c.capabilities.execution_enabled && c.capabilities.formats.includes(v.format)));
  const videoBlocked=variants.some(v=>v.channel==='facebook'&&isVideoFormat(v.format))&&!videoEnabled;
  const ready = variants.length>0&&!videoBlocked&&selected.every(Boolean);
  return <section className="card p-4 space-y-3"><h3 className="font-semibold">External publishing approval</h3>{videoBlocked?<p role="status">Facebook video execution is disabled pending separate live acceptance and activation.</p>:null}<p className="text-sm">Authorize revision {content.revision} for {stamp(content.scheduled_at)}. Posts due now may be sent by the worker immediately after authorization.</p>{variants.map((v, i) => <p className="text-sm" key={v.channel}>{label(v.channel)} → {selected[i]?.account_name || 'No enabled account for this format'}{selected[i] ? ` · Meta account ${selected[i].provider_account_id} · Test authorization` : ''}</p>)}{error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}<label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={accepted} disabled={!ready || busy} onChange={e => setAccepted(e.target.checked)} />I approve sending this exact caption and media to the listed accounts.</label><button className="btn-primary" disabled={!ready || !accepted || busy} onClick={async () => { const generation = lifetime.current;setBusy(true);try { await marketingService.execute(request.current, content, selected.map(c => c.id));if (generation === lifetime.current) onComplete(); } catch (e) { if (generation === lifetime.current) setError(e.message); } finally { if (generation === lifetime.current) setBusy(false); } }}>Authorize external publishing</button>{connections && !ready ? <p className="text-sm text-text-secondary">Connect an authorized account and configure its test-account allowlist before enabling external execution.</p> : null}</section>;
}

export function SocialEvidence({ organizationId, brandId }) {
  const auth = useAuth(), [page, setPage] = useState(1), [state, setState] = useState(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([organizationId, brandId, auth.user?.id]);
  useEffect(() => { setPage(1); }, [scope]);
  useEffect(() => { let live = true;setState(null);setError('');marketingService.integrations(organizationId, brandId, 'analytics', page).then(data => { if (live) setState(data); }).catch(e => { if (live) setError(e.message); });return () => { live = false; }; }, [scope, page, refresh]);
  return <section className="card p-5 space-y-3"><h2 className="font-semibold">Social evidence</h2><p className="text-sm text-text-secondary">Platform-reported observations retain their collection time. Reach is a platform estimate; it is not additive across posts. These metrics do not establish conversions or incremental revenue.</p><AsyncDataSurface loading={!state && !error} error={error} onRetry={() => setRefresh(v => v + 1)} isEmpty={state && !state.posts.length} emptyTitle="No synchronized platform evidence" hasData={Boolean(state?.posts.length)}>{state?.posts.map(p => <div className="marketing-row" key={p.id}><span><strong>{label(p.channel)} · {p.caption || 'Post without caption'}</strong><small>Published {stamp(p.published_at)} · Observed {stamp(p.observed_at)}</small><small>{Object.entries(p.metrics).map(([key, value]) => `${label(key)}: ${value}`).join(' · ') || 'No metrics returned'}</small><small>{Object.keys(p.unavailable_metrics).length ? `Unavailable: ${Object.keys(p.unavailable_metrics).map(label).join(', ')}` : ''}</small>{p.permalink ? <a className="text-sm underline" href={p.permalink} target="_blank" rel="noreferrer">View platform post</a> : null}</span></div>)}</AsyncDataSurface><AdminPagination page={page} pageSize={20} total={state?.total || 0} loading={!state && !error} onPageChange={setPage} noun="platform posts" /></section>;
}
