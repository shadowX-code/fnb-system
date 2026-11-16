import {useEffect,useState,useRef} from 'react';
import {assistantCall} from './nativeAssistantService.js';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';

const statuses={reserved:'Reserved',connecting:'Connecting',active:'Active',closing:'Closing',closed:'Closed',failed:'Failed',historical:'Historical evaluation'};
const availability={available:'Available to start',disabled:'Disabled by Admin',active_elsewhere:'Session already active',approval_required:'Approval required by policy',daily_limit:'Daily limit reached',capacity:'Environment at capacity'};
const tokens=value=>Number.isFinite(value)?value.toLocaleString():'Unavailable';
export default function VoiceUsage({onSaved}={}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[enabled,setEnabled]=useState(false),[daily,setDaily]=useState(''),[seconds,setSeconds]=useState(180),[concurrency,setConcurrency]=useState(4);
 const [status,setStatus]=useState('all'),[provider,setProvider]=useState('all'),[search,setSearch]=useState(''),[saved,setSaved]=useState(false);
 const epoch=useRef(0);
 async function load(){const n=++epoch.current;setError('');try{const r=await assistantCall('voice_usage');if(!r?.policy||!Array.isArray(r.sessions))throw new Error('Voice policy is unavailable.');if(n===epoch.current){setData(r);setEnabled(r.policy.enabled);setDaily(r.policy.per_user_daily_sessions??'');setSeconds(r.policy.max_seconds);setConcurrency(r.policy.max_concurrent_sessions);}}catch(e){if(n===epoch.current)setError(e.message);}}
 useEffect(()=>{void load();return()=>{epoch.current++;};},[]);
 async function save(e){e.preventDefault();if(!data?.can_edit||data.environment!=='staging')return;const n=epoch.current;setBusy(true);setError('');setSaved(false);try{await assistantCall('voice_policy_save',{revision:data.policy.revision,enabled,maximum_seconds:seconds,concurrency,daily_sessions:daily===''?null:Number(daily)});if(n!==epoch.current)return;await load();setSaved(true);await onSaved?.();}catch(e){if(n===epoch.current)setError(e.message);}finally{setBusy(false);}}
 const rows=(data?.sessions||[]).filter(s=>(status==='all'||(s.state||'historical')===status)&&(provider==='all'||s.provider===provider)&&(!search||[s.actor,s.request_id,s.reason].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
 const columns=[
  {key:'created_at',header:'Started',render:s=><span className="whitespace-nowrap">{s.created_at?formatOperationalMoment(s.created_at):'Not recorded'}</span>},
  {key:'provider',header:'Provider',render:s=>s.provider==='openai'?'OpenAI':s.provider==='grok'?'Grok':s.provider||'Not recorded'},
  {key:'state',header:'Status',render:s=><div className="space-y-1"><Badge tone={s.state==='failed'?'danger':s.state==='active'?'success':'neutral'}>{statuses[s.state||'historical']||s.state}</Badge>{s.reason&&<p className="text-xs text-text-secondary">{s.reason.replaceAll('_',' ')}</p>}</div>},
  {key:'duration',header:'Duration',align:'right',render:s=><span className="tabular-nums">{s.observed_duration_seconds!=null?`${s.observed_duration_seconds}s`:'Not recorded'}</span>},
  {key:'audio',header:'Audio tokens · in / out',align:'right',render:s=><span className="tabular-nums">{tokens(s.observed_usage?.input_audio_tokens)} / {tokens(s.observed_usage?.output_audio_tokens)}</span>},
  {key:'cost',header:'Cost',render:s=>Number.isFinite(s.estimated_cost_usd)?`Est. US$${s.estimated_cost_usd.toFixed(4)}`:'Unavailable'},
  {key:'details',header:'Details',render:s=><details className="text-xs"><summary className="cursor-pointer">Session details</summary><dl className="mt-2 max-w-52 space-y-2 break-all"><div><dt>User reference</dt><dd>{s.actor||'Not supplied'}</dd></div><div><dt>Session reference</dt><dd>{s.request_id}</dd></div><div><dt>Usage source</dt><dd>{s.observed_usage?'Browser-reported provider observation':'Not recorded'}</dd></div></dl></details>},
 ];
 return <section className="min-w-0 space-y-4" aria-label="Voice usage management">
 <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Voice &amp; Usage{data?` · ${data.environment==='staging'?'Staging':data.environment}`:''}</h3><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void load()}>Refresh usage</button></div>
 {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{saved&&<p role="status" className="text-sm text-text-secondary">Voice policy saved.</p>}{!data?<p role="status">{error?'Voice policy unavailable.':'Loading voice policy…'}</p>:<>
 <div className="flex flex-wrap items-center gap-3 text-sm"><Badge tone={data.policy.enabled?'success':'neutral'}>{data.policy.enabled?'Development voice enabled':'Voice disabled'}</Badge><span>Text remains available.</span></div>
 <dl className="grid gap-3 text-sm" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 200px), 1fr))"}}><div><dt className="text-text-secondary">Maximum session</dt><dd className="mt-1 tabular-nums">{data.policy.max_seconds} seconds</dd></div><div><dt className="text-text-secondary">Concurrency</dt><dd className="mt-1">{data.policy.max_concurrent_sessions} environment slots · 1 per user</dd></div><div><dt className="text-text-secondary">Daily sessions per user</dt><dd className="mt-1">{data.policy.per_user_daily_sessions??'No daily limit'}</dd></div></dl>
 {data.can_edit&&data.environment==='staging'&&<form onSubmit={save} className="space-y-3 border-t border-border pt-4" aria-label="Admin voice policy">
 <h4 className="text-sm font-semibold">Admin configuration</h4>
 <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="admin-checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/> Enable Staging voice</label>
 <div className="grid gap-3" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 200px), 1fr))"}}><AdminFormField label="Maximum session (seconds)"><input className="control" type="number" min="30" max="180" required disabled={busy} value={seconds} onChange={e=>setSeconds(e.target.valueAsNumber)}/></AdminFormField>
 <AdminFormField label="Concurrent environment sessions"><input className="control" type="number" min="1" max="8" required disabled={busy} value={concurrency} onChange={e=>setConcurrency(e.target.valueAsNumber)}/></AdminFormField>
 <AdminFormField label="Optional daily sessions per user"><input className="control" type="number" min="0" max="100" disabled={busy} placeholder="No daily limit" value={daily} onChange={e=>setDaily(e.target.value)}/></AdminFormField></div>
 <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-text-secondary">No fixed evaluation allowance. Provider billing and rate limits still apply.</p><button className="btn-secondary" disabled={busy}>Save limits</button></div>
 </form>}
 <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Your availability &amp; safety controls</summary><div className="mt-2 space-y-2"><p>{availability[data.state]||'Availability not supplied'}. {data.reset_condition}</p><p>{data.policy.approval_required?'This environment requires approval.':'No individual approval is required by this policy.'} Expired and revoked sessions are closed by the server cleanup worker.</p><p>Production voice remains disabled until separately approved; this page does not activate it.</p></div></details>
 <div className="space-y-3 border-t border-border pt-4"><div><h4 className="text-sm font-semibold">Recent voice sessions</h4><p className="mt-1 text-xs text-text-secondary">{data.can_edit?'Environment sessions':'Your sessions'} · {data.sessions.length} most recent records returned. Filters apply to these records only.</p></div>
 <AdminFilterToolbar compact presentation="inline" search={<AdminSearchField label="Search sessions" value={search} onChange={setSearch} placeholder="User, session or end reason"/>} filters={<><SelectField label="Status" value={status} onChange={setStatus} options={[{value:'all',label:'All'},...Object.entries(statuses).map(([value,label])=>({value,label}))]}/><SelectField label="Provider" value={provider} onChange={setProvider} options={[{value:'all',label:'All'},{value:'openai',label:'OpenAI'},{value:'grok',label:'Grok'}]}/></>} onClear={()=>{setStatus('all');setProvider('all');setSearch('');}} activeFilters={[...(status!=='all'?[{key:'status',label:'Status',value:statuses[status],onRemove:()=>setStatus('all')}]:[]),...(provider!=='all'?[{key:'provider',label:'Provider',value:provider,onRemove:()=>setProvider('all')}]:[]),...(search?[{key:'search',label:'Search',value:search,onRemove:()=>setSearch('')}]:[])]}/>
 <p className="text-xs text-text-secondary" role="status">{rows.length} of {data.sessions.length} sessions</p>
 {rows.length?<DataTable rows={rows} columns={columns} getRowKey={s=>s.request_id} density="compact" mobileLayout="stack" minWidth={760}/>:<p className="py-4 text-sm text-text-secondary">{data.sessions.length?'No sessions match these filters.':'No voice sessions recorded.'}</p>}
 <p className="text-xs text-text-secondary">Duration uses server connection and termination timestamps. Audio tokens are observed provider usage, reported by the browser; missing values are not zero. Costs, when available, are estimates, not finalized provider charges.</p>
 </div>
 </>}
 </section>;
}
