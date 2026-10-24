import {publishingFormatEnabled} from '../../../supabase/functions/_shared/publishingFormatPolicy.mjs';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import { marketingService } from './marketingService.js';
const label = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const stamp = value => value ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(value)) : 'Unavailable';
const active = c => ['test_authorized', 'production_authorized'].includes(c.status) && Date.parse(c.expires_at) > Date.now();

export { default as MetaConnections } from './SocialAccounts.jsx';

export function PublishAuthorization({content,onComplete,intent=null,brandName,onEdit}) {
 const auth=useAuth(),[connections,setConnections]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[acceptedFor,setAcceptedFor]=useState(null),[config,setConfig]=useState({});
 const request=useRef(null),sending=useRef(false),lifetime=useRef(0);
 const mode=intent?.mode,scheduledAt=intent?.scheduled_at;
 const direct=Boolean(intent)&&['draft','approved'].includes(content.status),allowed=auth.hasPermission('marketing_content.execute')&&auth.hasPermission('marketing_content.publish')&&(direct||['scheduled','failed'].includes(content.status));
 const variants=direct?content.payload.variants:content.payload.variants.filter(v=>!content.channels||content.channels.some(c=>c.channel===v.channel&&['blocked','queued','retry'].includes(c.job_state)));
 const media=content.channels?.flatMap(c=>c.assets||[])||[];
 const savedFingerprint=JSON.stringify([content.id,content.organization_id,content.brand_id,content.revision,content.status,content.payload,content.channels,intent]);
 useEffect(()=>{let live=true;lifetime.current++;setConnections(null);setError('');setAcceptedFor(null);if(allowed)Promise.all([marketingService.integrations(content.organization_id,content.brand_id,'content'),marketingService.metaConfiguration()]).then(([data,value])=>{if(live){setConnections(data.connections);setConfig(value)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;lifetime.current++}},[savedFingerprint,auth.user?.id,allowed]);
 if(!allowed)return null;
 const selected=variants.map(v=>connections?.find(c=>c.organization_id===content.organization_id&&c.brand_id===content.brand_id&&c.channel===v.channel&&active(c)&&c.capabilities.publishing&&c.capabilities.execution_enabled&&c.capabilities.formats.includes(v.format)));
 const videoBlocked=variants.some((v,i)=>!publishingFormatEnabled(v,(v.asset_ids||[]).map(id=>media.find(a=>a.id===id)?.mime_type),selected[i]?.format_authorizations,config)||v.format==='carousel'&&(v.asset_ids||[]).some(id=>!media.some(a=>a.id===id)));
 const executionReady=config.test_execution_configured===true||config.production_execution_enabled===true;
 let intentError='';
 if(direct){
  if(!['now','schedule'].includes(mode))intentError='Return to the editor and choose Publish Now or Schedule.';
  else if(mode==='schedule'&&(typeof scheduledAt!=='string'||!scheduledAt.includes('T')||!/(Z|[+-]\d{2}:\d{2})$/.test(scheduledAt)||!Number.isFinite(Date.parse(scheduledAt))||Date.parse(scheduledAt)<=Date.now()))intentError='Return to the editor and choose a valid future publishing date and time.';
 }
 const confirmation=JSON.stringify([savedFingerprint,selected,config]);
 const ready=variants.length>0&&!videoBlocked&&executionReady&&!intentError&&selected.every(Boolean);
 const accepted=acceptedFor===confirmation;
 return <section className="space-y-4" aria-label="Publishing confirmation"><h3 className="font-semibold">{direct?'Publishing summary':'External publishing approval'}</h3>
 <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"><dt className="text-text-secondary">Brand</dt><dd className="font-medium break-words">{brandName||content.brand_name||'Brand unavailable'}</dd><dt className="text-text-secondary">Action</dt><dd>{direct?mode==='schedule'?'Schedule Publishing':mode==='now'?'Publish Now':'Choose in editor':'Authorize pending channels'}</dd>
 {direct&&mode==='schedule'?<><dt className="text-text-secondary">Scheduled for</dt><dd>{Number.isFinite(Date.parse(scheduledAt))?stamp(scheduledAt):'Date and time required'}<span className="block text-xs text-text-secondary">Asia/Kuala_Lumpur</span></dd></>:null}</dl>
 <ul className="divide-y divide-border rounded-xl border border-border">{variants.map((v,i)=><li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" key={v.channel}><span><strong>{label(v.channel)}</strong><span className="block text-text-secondary">{selected[i]?.account_name||'No enabled account for this format'}</span></span><span className="badge">{label(v.format)}</span></li>)}</ul>
 {intentError?<p role="alert" className="text-sm text-rose-600">{intentError}</p>:null}
 {videoBlocked?<p role="status">Publishing for this format is disabled for the selected account or its media details are unavailable.</p>:null}{connections&&!executionReady?<p role="status">Publishing execution is disabled. The saved draft remains available.</p>:null}
 {error?<p role="alert" className="text-sm text-rose-600">{error}</p>:null}
 <p className="text-sm text-text-secondary">{direct?mode==='schedule'?'This confirms the saved content for the time shown above.':mode==='now'?'This confirms the saved content for immediate publishing.':'Choose a publishing action in the editor.':'This authorizes only pending channels of the saved revision.'}</p>
 <details className="text-sm text-text-secondary"><summary className="cursor-pointer">Connection details</summary><p className="mt-2">Saved revision {content.revision}</p>{selected.filter(Boolean).map(c=><p className="break-all" key={c.id}>{label(c.channel)} · {c.provider_account_id} · Connection version {c.credential_generation}</p>)}</details>
 <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={accepted} disabled={!ready||busy} onChange={e=>setAcceptedFor(e.target.checked?confirmation:null)}/>I approve sending this exact caption and media to the listed accounts.</label>
 <div className="flex flex-wrap justify-end gap-2">{direct&&onEdit?<button className="btn-secondary" disabled={busy} onClick={onEdit}>Back to editor</button>:null}<button className="btn-primary" disabled={!ready||!accepted||busy} onClick={async()=>{
  if(sending.current||!ready||!accepted)return;const generation=lifetime.current;sending.current=true;setBusy(true);setError('');
  const payload=direct?{confirm:true,timezone:'Asia/Kuala_Lumpur',...(mode==='schedule'?{scheduled_at:scheduledAt}:{}),accounts:selected.map(c=>({connection_id:c.id,provider_account_id:c.provider_account_id,generation:c.credential_generation,channel:c.channel}))}:null;
  const fp=JSON.stringify([confirmation,payload]);if(request.current?.fp!==fp)request.current={fp,id:crypto.randomUUID()};
  try{if(direct)await marketingService.content({requestId:request.current.id,command:mode==='schedule'?'schedule_publish':'publish_now',organizationId:content.organization_id,brandId:content.brand_id,content,payload});else await marketingService.execute(request.current.id,content,selected.map(c=>c.id));if(generation===lifetime.current)onComplete();}catch(e){if(generation===lifetime.current){setError(e.message);if(e.cause?.code==='40001'||e.cause?.code==='42501')setAcceptedFor(null);}}finally{sending.current=false;if(generation===lifetime.current)setBusy(false)}
 }}>{busy?'Confirming…':direct?mode==='schedule'?'Confirm Schedule':'Confirm Publish':'Authorize external publishing'}</button></div>
 {connections&&!ready?<p className="text-sm text-text-secondary">Resolve the reported prerequisites before confirming. Your saved content remains available.</p>:null}</section>;
}

export function SocialEvidence({ organizationId, brandId }) {
  const auth = useAuth(), [page, setPage] = useState(1), [state, setState] = useState(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([organizationId, brandId, auth.user?.id]);
  useEffect(() => { setPage(1); }, [scope]);
  useEffect(() => { let live = true;setState(null);setError('');marketingService.integrations(organizationId, brandId, 'analytics', page).then(data => { if (live) setState(data); }).catch(e => { if (live) setError(e.message); });return () => { live = false; }; }, [scope, page, refresh]);
  return <section className="card p-5 space-y-3"><h2 className="font-semibold">Social evidence</h2><p className="text-sm text-text-secondary">Platform-reported observations retain their collection time. Reach is a platform estimate; it is not additive across posts. These metrics do not establish conversions or incremental revenue.</p><AsyncDataSurface loading={!state && !error} error={error} onRetry={() => setRefresh(v => v + 1)} isEmpty={state && !state.posts.length} emptyTitle="No synchronized platform evidence" hasData={Boolean(state?.posts.length)}>{state?.posts.map(p => <div className="marketing-row" key={p.id}><span><strong>{label(p.channel)} · {p.caption || 'Post without caption'}</strong><small>Published {stamp(p.published_at)} · Observed {stamp(p.observed_at)}</small><small>{Object.entries(p.metrics).map(([key, value]) => `${label(key)}: ${value}`).join(' · ') || 'No metrics returned'}</small><small>{Object.keys(p.unavailable_metrics).length ? `Unavailable: ${Object.keys(p.unavailable_metrics).map(label).join(', ')}` : ''}</small>{p.permalink ? <a className="text-sm underline" href={p.permalink} target="_blank" rel="noreferrer">View platform post</a> : null}</span></div>)}</AsyncDataSurface><AdminPagination page={page} pageSize={20} total={state?.total || 0} loading={!state && !error} onPageChange={setPage} noun="platform posts" /></section>;
}
