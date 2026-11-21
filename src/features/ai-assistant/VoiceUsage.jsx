import {useEffect,useState,useRef,useCallback} from 'react';
import {assistantCall} from './nativeAssistantService.js';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {usageNumber,formatVoiceCost,voiceCostCoverage,voiceMeteredDetails} from './voiceUsageSummary.js';

const statuses={reserved:'Reserved',connecting:'Connecting',active:'Active',closing:'Closing',closed:'Closed',failed:'Failed',historical:'Historical evaluation'};
const availability={available:'Available to start',disabled:'Disabled by Admin',active_elsewhere:'Session already active',approval_required:'Approval required by policy',daily_limit:'Daily limit reached',capacity:'Environment at capacity'};
const periods = [{value:'month',label:'This month'},{value:'7d',label:'Last 7 days'},{value:'30d',label:'Last 30 days'},{value:'all',label:'All time'}];
const billingUrl = 'https://platform.openai.com/settings/organization/billing/overview';
const policyGrid={gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 190px), 1fr))'};
export default function VoiceUsage({onSaved}={}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[enabled,setEnabled]=useState(false),[daily,setDaily]=useState(''),[seconds,setSeconds]=useState(180),[concurrency,setConcurrency]=useState(4);
 const [period,setPeriod]=useState('month'),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[saved,setSaved]=useState(false),[loading,setLoading]=useState(true);
 const epoch=useRef(0);
 function resetDraft(policy){setEnabled(policy.enabled);setDaily(policy.per_user_daily_sessions??'');setSeconds(policy.max_seconds);setConcurrency(policy.max_concurrent_sessions);}
 const load=useCallback(async()=>{
  const n=++epoch.current;
  setLoading(true);setError('');
  try {
   const result=await assistantCall('voice_usage',{period,status,page});
   if(!result?.policy||!Array.isArray(result.sessions)||!result.summary)throw new Error('Voice usage is unavailable.');
   if(n!==epoch.current)return false;
   setData(result);
   return true;
  }catch(e){if(n===epoch.current)setError(e.message);}
  finally{if(n===epoch.current)setLoading(false);}
  return false;
 },[period,status,page]);
 useEffect(()=>{void load();return()=>{epoch.current++;};},[load]);
 async function save(e){
  e.preventDefault();if(!editing||!data?.can_edit||data.environment!=='staging')return;
  const n=epoch.current;setBusy(true);setError('');setSaved(false);
  try{
   await assistantCall('voice_policy_save',{revision:data.policy.revision,enabled,maximum_seconds:seconds,concurrency,daily_sessions:daily===''?null:Number(daily)});
   if(n!==epoch.current)return;
   // A failed readback must not present an old policy as the saved configuration.
   const refreshed=await load();if(refreshed){setSaved(true);setEditing(false);await onSaved?.();}
  }catch(e){if(n===epoch.current)setError(e.message);}finally{setBusy(false);}
 }
 const current = data && !loading && !error;
 const rows = current ? data.sessions : [];
 const summary = current ? data.summary : null;
 const filteredCount = current ? data.filtered_count : 0;
 const totalPages = Math.max(1,Math.ceil(filteredCount/(data?.page_size||30)));
 const amount = formatVoiceCost(summary?.cost_nano_usd);
 const attributed = summary && summary.estimated_sessions + summary.partial_sessions;
 const columns=[
  {key:'created_at',header:'Started',render:s=><span className="whitespace-nowrap">{s.created_at?formatOperationalMoment(s.created_at):'Not recorded'}</span>},
  {key:'provider',header:'Provider',render:s=>s.provider==='openai'?'OpenAI':s.provider==='grok'?'Grok':s.provider||'Not recorded'},
  {key:'state',header:'Status',render:s=><Badge tone={s.state==='failed'?'danger':s.state==='active'?'success':'neutral'}>{statuses[s.state||'historical']||s.state}</Badge>},
  {key:'duration',header:'Duration',align:'right',render:s=><span className="tabular-nums">{Number.isSafeInteger(s.observed_duration_seconds)&&s.observed_duration_seconds>=0?`${s.observed_duration_seconds}s`:'Not recorded'}</span>},
  {key:'audio',header:'Audio tokens · in / out',align:'right',render:s=><span className="tabular-nums">{usageNumber(s.observed_usage?.input_audio_tokens)} / {usageNumber(s.observed_usage?.output_audio_tokens)}</span>},
  {key:'cost',header:'Estimated cost',render:s=>{
   const cost=voiceCostCoverage(s);
   return <span className="tabular-nums">{cost.amount}{cost.state==='partial'&&<small className="block text-text-secondary">Partial</small>}</span>;
  }},
  {key:'details',header:'Details',render:s=>{
   const cost=voiceCostCoverage(s);
   const metered=voiceMeteredDetails(s.observed_usage);
   return <details className="text-xs"><summary className="cursor-pointer">Session details</summary>
    <dl className="mt-2 max-w-64 space-y-2 break-words">
     <div><dt className="font-medium">End reason</dt><dd>{s.reason?.replaceAll('_',' ')||'Not recorded'}</dd></div>
     <div><dt className="font-medium">User reference</dt><dd className="break-all">{s.actor||'Not supplied'}</dd></div>
     <div><dt className="font-medium">Session reference</dt><dd className="break-all">{s.request_id}</dd></div>
     <div><dt className="font-medium">Cost attribution</dt><dd>{cost.reason}</dd></div>
     {metered.map(([label,value])=><div key={label}><dt className="font-medium">{label}</dt><dd>{value}</dd></div>)}
     {cost.version&&<div><dt className="font-medium">Rate card</dt><dd><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer" className="text-primary-ink underline">{cost.version} · USD</a></dd></div>}
    </dl>
   </details>;
  }},
 ];
 return <section className="min-w-0 space-y-4" aria-label="Voice usage management">
 <section aria-labelledby="voice-usage-overview">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h3 id="voice-usage-overview" className="text-sm font-semibold">Usage Overview</h3>
   <button type="button" className="btn-secondary" disabled={busy||editing||loading} onClick={()=>void load()}>Refresh usage</button>
  </div>
  {error&&<p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
  {current&&<p className="mt-1 text-xs text-text-secondary">
   {data.can_edit?'Staging environment':'Your sessions'} · {data.period_start?`Since ${formatOperationalMoment(data.period_start)} · `:'All time · '}
   Through {formatOperationalMoment(data.as_of)}
  </p>}
  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-3 lg:grid-cols-4">
   <div><dt className="text-xs text-text-secondary">Estimated cost</dt><dd className="mt-1 font-semibold tabular-nums">{summary?amount:'—'}</dd>
    {summary&&<dd className="text-xs text-text-secondary">{attributed>0&&summary.estimated_sessions<summary.sessions?'Partial subtotal · ':''}{summary.estimated_sessions} estimated · {summary.partial_sessions} partial · {summary.sessions-attributed} unavailable</dd>}</div>
   <div><dt className="text-xs text-text-secondary">OpenAI API credits</dt><dd className="mt-1 font-semibold">Not connected</dd>
    <dd className="text-xs text-text-secondary">Organization balance · <a className="text-primary-ink underline" href={billingUrl} target="_blank" rel="noreferrer">OpenAI Billing</a></dd></div>
   <div><dt className="text-xs text-text-secondary">Sessions</dt><dd className="mt-1 font-semibold tabular-nums">{summary?.sessions??'—'}</dd></div>
   <div><dt className="text-xs text-text-secondary">Recorded duration</dt><dd className="mt-1 font-semibold tabular-nums">{summary?summary.duration_seconds===null?'Unavailable':`${usageNumber(summary.duration_seconds)}s`:'—'}</dd>
    {summary&&<dd className="text-xs text-text-secondary">{summary.duration_sessions}/{summary.sessions} sessions timed</dd>}</div>
  </dl>
  <p className="mt-2 text-xs text-text-secondary">Estimates use recorded provider usage and USD list rates. Provider charges are reconciled in OpenAI Billing. Duration measures connected call time.</p>
 </section>
 {loading&&<p role="status" className="text-xs text-text-secondary">Loading voice usage…</p>}
 {data&&<section aria-labelledby="voice-policy-heading">
 <div className="flex flex-wrap items-center justify-between gap-2">
  <h3 id="voice-policy-heading" className="text-sm font-semibold">Voice Policy · {data.environment==='staging'?'Staging':data.environment}</h3>
  {data.can_edit&&data.environment==='staging'&&!editing&&<button type="button" className="btn-secondary" disabled={loading} onClick={()=>{resetDraft(data.policy);setEditing(true);setSaved(false);}}>Edit policy</button>}
 </div>
 {saved&&<p role="status" className="text-sm text-text-secondary">Voice policy saved.</p>}
 <form onSubmit={save} className="space-y-3" aria-label="Voice policy">
 <div className="grid items-start gap-3" style={policyGrid}>
  <AdminFormField label="Environment availability" as="div">{editing?<label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="admin-checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/> Enable Staging voice</label>:<p className="py-2"><Badge tone={data.policy.enabled?'success':'neutral'}>{data.policy.enabled?'Development voice enabled':'Voice disabled'}</Badge></p>}</AdminFormField>
  <AdminFormField label="Maximum session (seconds)" as={editing?'label':'div'}>{editing?<input className="control" type="number" min="30" max="180" required disabled={busy} value={seconds} onChange={e=>setSeconds(e.target.valueAsNumber)}/>:<p className="py-2 text-sm tabular-nums">{data.policy.max_seconds} seconds</p>}</AdminFormField>
  <AdminFormField label="Concurrent environment sessions" as={editing?'label':'div'}>{editing?<input className="control" type="number" min="1" max="8" required disabled={busy} value={concurrency} onChange={e=>setConcurrency(e.target.valueAsNumber)}/>:<p className="py-2 text-sm">{data.policy.max_concurrent_sessions} slots · 1 per user</p>}</AdminFormField>
  <AdminFormField label="Optional daily sessions per user" as={editing?'label':'div'}>{editing?<input className="control" type="number" min="0" max="100" disabled={busy} placeholder="No daily limit" value={daily} onChange={e=>setDaily(e.target.value)}/>:<p className="py-2 text-sm">{data.policy.per_user_daily_sessions??'No daily limit'}</p>}</AdminFormField>
 </div>
 {editing&&<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{resetDraft(data.policy);setEditing(false);}}>Cancel</button><button className="btn-primary" disabled={busy}>Save limits</button></div>}
 </form>
 <details className="mt-1 text-xs text-text-secondary"><summary className="cursor-pointer">Availability and safeguards</summary>
  <p className="mt-1">{availability[data.state]||'Availability not supplied'}. {data.reset_condition||'No fixed evaluation allowance. Provider billing and rate limits still apply.'}</p>
  <p className="mt-1">{data.policy.approval_required?'This environment requires approval.':'No individual approval is required by this policy.'} The server closes expired and revoked sessions.</p>
 </details>
 </section>}
 <section className="space-y-2 border-t border-border pt-3" aria-labelledby="voice-history-heading">
  <h3 id="voice-history-heading" className="text-sm font-semibold">Session History</h3>
  <AdminFilterToolbar compact denseFields presentation="inline" filters={<>
   <SelectField label="Period" value={period} disabled={editing||busy} onChange={value=>{setPeriod(value);setPage(1);}} options={periods}/>
   <SelectField label="Status" value={status} disabled={editing||busy} onChange={value=>{setStatus(value);setPage(1);}} options={[{value:'all',label:'All'},...Object.entries(statuses).map(([value,label])=>({value,label}))]}/>
  </>} activeFilters={status==='all'?[]:[{key:'status',label:'Status',value:statuses[status],onRemove:()=>{if(!editing&&!busy){setStatus('all');setPage(1);}}}]}/>
  {current&&<>
   <p className="text-xs text-text-secondary" role="status">{filteredCount} matching sessions · Overview includes all statuses in the period.</p>
   {rows.length?<DataTable rows={rows} columns={columns} getRowKey={s=>`${s.actor}:${s.request_id}`} density="compact" mobileLayout="stack" minWidth={720}/>:<p className="py-3 text-sm text-text-secondary">No sessions match these filters on this page.</p>}
   {totalPages>1&&<div className="flex items-center justify-end gap-2">
    <button type="button" className="btn-secondary" disabled={page<=1||editing||busy} onClick={()=>setPage(page-1)}>Previous</button>
    <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
    <button type="button" className="btn-secondary" disabled={page>=totalPages||editing||busy} onClick={()=>setPage(page+1)}>Next</button>
   </div>}
  </>}
 </section>
 </section>;
}
