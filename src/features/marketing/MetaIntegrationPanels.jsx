import {publishingFormatEnabled} from '../../../supabase/functions/_shared/publishingFormatPolicy.mjs';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import DateTimePickerField from '../../components/forms/DateTimePickerField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import {localInput,scheduleInstant} from './marketingCalendar.js';
import { marketingService } from './marketingService.js';
const label = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const stamp = value => value ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(value)) : 'Unavailable';
const active = c => ['test_authorized', 'production_authorized'].includes(c.status) && Date.parse(c.expires_at) > Date.now();

export { default as MetaConnections } from './SocialAccounts.jsx';

export function PublishAuthorization({content,onComplete,intent=null}) {
 const auth=useAuth(),[connections,setConnections]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[config,setConfig]=useState({}),[mode,setMode]=useState(intent?.mode||'now'),[local,setLocal]=useState(intent?.scheduled_at?localInput(new Date(intent.scheduled_at),'Asia/Kuala_Lumpur'):'');
 const request=useRef(null),sending=useRef(false),lifetime=useRef(0);
 const direct=Boolean(intent)&&['draft','approved'].includes(content.status),allowed=auth.hasPermission('marketing_content.execute')&&auth.hasPermission('marketing_content.publish')&&(direct||['scheduled','failed'].includes(content.status));
 const variants=direct?content.payload.variants:content.payload.variants.filter(v=>!content.channels||content.channels.some(c=>c.channel===v.channel&&['blocked','queued','retry'].includes(c.job_state)));
 const media=content.channels?.flatMap(c=>c.assets||[])||[];
 useEffect(()=>{let live=true;lifetime.current++;setConnections(null);setError('');setAccepted(false);if(allowed)Promise.all([marketingService.integrations(content.organization_id,content.brand_id,'content'),marketingService.metaConfiguration()]).then(([data,value])=>{if(live){setConnections(data.connections);setConfig(value)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;lifetime.current++}},[content.id,content.revision,content.status,auth.user?.id,allowed]);
 if(!allowed)return null;
 const selected=variants.map(v=>connections?.find(c=>c.organization_id===content.organization_id&&c.brand_id===content.brand_id&&c.channel===v.channel&&active(c)&&c.capabilities.publishing&&c.capabilities.execution_enabled&&c.capabilities.formats.includes(v.format)));
 const videoBlocked=variants.some((v,i)=>!publishingFormatEnabled(v,(v.asset_ids||[]).map(id=>media.find(a=>a.id===id)?.mime_type),selected[i]?.format_authorizations,config)||v.format==='carousel'&&(v.asset_ids||[]).some(id=>!media.some(a=>a.id===id)));
 const executionReady=config.test_execution_configured===true||config.production_execution_enabled===true;
 let scheduledAt=null,dateError='';if(direct&&mode==='schedule'){try{scheduledAt=scheduleInstant(local,'Asia/Kuala_Lumpur');if(Date.parse(scheduledAt)<=Date.now())throw new Error('Choose a future publishing date and time.');}catch(e){dateError=e.message}}
 const ready=variants.length>0&&!videoBlocked&&executionReady&&!dateError&&selected.every(Boolean);
 return <section className="card p-4 space-y-3" aria-label="Publishing confirmation"><h3 className="font-semibold">{direct?'Confirm publishing':'External publishing approval'}</h3>
 {direct?<><AdminSegmentedControl label="Publishing action" value={mode} onChange={value=>{setMode(value);setAccepted(false)}} options={[{value:'now',label:'Publish Now'},{value:'schedule',label:'Schedule'}]}/>{mode==='schedule'?<DateTimePickerField label="Publishing" timezone="Asia/Kuala_Lumpur" value={local} onChange={value=>{setLocal(value);setAccepted(false)}} error={dateError}/>:null}<p className="text-sm">{content.status==='draft'?'Your publishing permissions allow you to confirm this saved revision without a separate review.':'This revision retains its existing approval.'} {mode==='now'?'Confirming may publish immediately.':'Confirming activates the chosen future schedule.'}</p></>:<p className="text-sm">Authorize revision {content.revision} for {stamp(content.scheduled_at)}. Posts due now may be sent immediately after authorization.</p>}
 {videoBlocked?<p role="status">Publishing for this format is disabled for the selected account or its media details are unavailable.</p>:null}{connections&&!executionReady?<p role="status">Publishing execution is disabled. The saved draft remains available.</p>:null}
 {variants.map((v,i)=><p className="text-sm" key={v.channel}>{label(v.channel)} → {selected[i]?.account_name||'No enabled account for this format'}{selected[i]?` · Meta account ${selected[i].provider_account_id}`:''}</p>)}
 {error?<p role="alert" className="text-sm text-rose-600">{error}</p>:null}<label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={accepted} disabled={!ready||busy} onChange={e=>setAccepted(e.target.checked)}/>I approve sending this exact caption and media to the listed accounts.</label>
 <button className="btn-primary" disabled={!ready||!accepted||busy} onClick={async()=>{
  if(sending.current)return;const generation=lifetime.current;sending.current=true;setBusy(true);setError('');
  const payload=direct?{confirm:true,timezone:'Asia/Kuala_Lumpur',...(mode==='schedule'?{scheduled_at:scheduledAt}:{}),accounts:selected.map(c=>({connection_id:c.id,provider_account_id:c.provider_account_id,generation:c.credential_generation,channel:c.channel}))}:null;
  const fp=JSON.stringify([content.id,content.revision,mode,payload,selected.map(c=>c.id)]);if(request.current?.fp!==fp)request.current={fp,id:crypto.randomUUID()};
  try{if(direct)await marketingService.content({requestId:request.current.id,command:mode==='schedule'?'schedule_publish':'publish_now',organizationId:content.organization_id,brandId:content.brand_id,content,payload});else await marketingService.execute(request.current.id,content,selected.map(c=>c.id));if(generation===lifetime.current)onComplete();}catch(e){if(generation===lifetime.current)setError(e.message)}finally{sending.current=false;if(generation===lifetime.current)setBusy(false)}
 }}>{busy?'Confirming…':direct?mode==='schedule'?'Confirm Schedule':'Confirm Publish Now':'Authorize external publishing'}</button>
 {connections&&!ready?<p className="text-sm text-text-secondary">Publishing requires eligible enabled accounts, the current connection generation and an available execution policy. Resolve any reported prerequisite before confirming.</p>:null}</section>;
}

export function SocialEvidence({ organizationId, brandId }) {
  const auth = useAuth(), [page, setPage] = useState(1), [state, setState] = useState(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([organizationId, brandId, auth.user?.id]);
  useEffect(() => { setPage(1); }, [scope]);
  useEffect(() => { let live = true;setState(null);setError('');marketingService.integrations(organizationId, brandId, 'analytics', page).then(data => { if (live) setState(data); }).catch(e => { if (live) setError(e.message); });return () => { live = false; }; }, [scope, page, refresh]);
  return <section className="card p-5 space-y-3"><h2 className="font-semibold">Social evidence</h2><p className="text-sm text-text-secondary">Platform-reported observations retain their collection time. Reach is a platform estimate; it is not additive across posts. These metrics do not establish conversions or incremental revenue.</p><AsyncDataSurface loading={!state && !error} error={error} onRetry={() => setRefresh(v => v + 1)} isEmpty={state && !state.posts.length} emptyTitle="No synchronized platform evidence" hasData={Boolean(state?.posts.length)}>{state?.posts.map(p => <div className="marketing-row" key={p.id}><span><strong>{label(p.channel)} · {p.caption || 'Post without caption'}</strong><small>Published {stamp(p.published_at)} · Observed {stamp(p.observed_at)}</small><small>{Object.entries(p.metrics).map(([key, value]) => `${label(key)}: ${value}`).join(' · ') || 'No metrics returned'}</small><small>{Object.keys(p.unavailable_metrics).length ? `Unavailable: ${Object.keys(p.unavailable_metrics).map(label).join(', ')}` : ''}</small>{p.permalink ? <a className="text-sm underline" href={p.permalink} target="_blank" rel="noreferrer">View platform post</a> : null}</span></div>)}</AsyncDataSurface><AdminPagination page={page} pageSize={20} total={state?.total || 0} loading={!state && !error} onPageChange={setPage} noun="platform posts" /></section>;
}
