import {useEffect,useState,useRef} from 'react';
import {assistantCall} from './nativeAssistantService.js';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {summarizeVoiceUsage,usageNumber,voiceCostCoverage} from './voiceUsageSummary.js';

const statuses={reserved:'Reserved',connecting:'Connecting',active:'Active',closing:'Closing',closed:'Closed',failed:'Failed',historical:'Historical evaluation'};
const availability={available:'Available to start',disabled:'Disabled by Admin',active_elsewhere:'Session already active',approval_required:'Approval required by policy',daily_limit:'Daily limit reached',capacity:'Environment at capacity'};
const policyGrid={gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 190px), 1fr))'};
export default function VoiceUsage({onSaved}={}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[enabled,setEnabled]=useState(false),[daily,setDaily]=useState(''),[seconds,setSeconds]=useState(180),[concurrency,setConcurrency]=useState(4);
 const [status,setStatus]=useState('all'),[provider,setProvider]=useState('all'),[search,setSearch]=useState(''),[saved,setSaved]=useState(false);
 const epoch=useRef(0);
 function resetDraft(policy){setEnabled(policy.enabled);setDaily(policy.per_user_daily_sessions??'');setSeconds(policy.max_seconds);setConcurrency(policy.max_concurrent_sessions);}
 async function load(){const n=++epoch.current;setError('');try{const r=await assistantCall('voice_usage');if(!r?.policy||!Array.isArray(r.sessions))throw new Error('Voice policy is unavailable.');if(n===epoch.current){setData(r);resetDraft(r.policy);return true;}}catch(e){if(n===epoch.current)setError(e.message);}return false;}
 useEffect(()=>{void load();return()=>{epoch.current++;};},[]);
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
 const rows=(data?.sessions||[]).filter(s=>(status==='all'||(s.state||'historical')===status)&&(provider==='all'||s.provider===provider)&&(!search||[s.actor,s.request_id,s.reason].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
 const summary=summarizeVoiceUsage(rows);
 const columns=[
  {key:'created_at',header:'Started',render:s=><span className="whitespace-nowrap">{s.created_at?formatOperationalMoment(s.created_at):'Not recorded'}</span>},
  {key:'provider',header:'Provider',render:s=>s.provider==='openai'?'OpenAI':s.provider==='grok'?'Grok':s.provider||'Not recorded'},
  {key:'state',header:'Status',render:s=><Badge tone={s.state==='failed'?'danger':s.state==='active'?'success':'neutral'}>{statuses[s.state||'historical']||s.state}</Badge>},
  {key:'duration',header:'Duration',align:'right',render:s=><span className="tabular-nums">{Number.isSafeInteger(s.observed_duration_seconds)&&s.observed_duration_seconds>=0?`${s.observed_duration_seconds}s`:'Not recorded'}</span>},
  {key:'audio',header:'Audio tokens · in / out',align:'right',render:s=><span className="tabular-nums">{usageNumber(s.observed_usage?.input_audio_tokens)} / {usageNumber(s.observed_usage?.output_audio_tokens)}</span>},
  {key:'cost',header:'Estimated cost',render:()=> <span>Unavailable</span>},
  {key:'details',header:'Details',render:s=>{const cost=voiceCostCoverage(s);return <details className="text-xs"><summary className="cursor-pointer">Session details</summary><dl className="mt-2 max-w-64 space-y-2 break-words"><div><dt className="font-medium">End reason</dt><dd>{s.reason?.replaceAll('_',' ')||'Not recorded'}</dd></div><div><dt className="font-medium">User reference</dt><dd className="break-all">{s.actor||'Not supplied'}</dd></div><div><dt className="font-medium">Session reference</dt><dd className="break-all">{s.request_id}</dd></div><div><dt className="font-medium">Usage source</dt><dd>{s.observed_usage?'Browser-reported provider observation':'Not recorded'}</dd></div><div><dt className="font-medium">Why cost is unavailable</dt><dd>{cost.reason} Missing: {cost.missing.join('; ')}. No finalized provider charge is supplied.</dd></div></dl></details>;}},
 ];
 return <section className="min-w-0 space-y-4" aria-label="Voice usage management">
 <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Voice Policy{data?` · ${data.environment==='staging'?'Staging':data.environment}`:''}</h3><div className="flex items-center gap-2"><span className="text-xs text-text-secondary">{editing?'Edit mode':'View mode'}</span>{data?.can_edit&&data.environment==='staging'&&!editing&&<button type="button" className="btn-secondary" onClick={()=>{resetDraft(data.policy);setEditing(true);setSaved(false);}}>Edit policy</button>}<button type="button" className="btn-secondary" disabled={busy||editing} onClick={()=>void load()}>Refresh usage</button></div></div>
 {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{saved&&<p role="status" className="text-sm text-text-secondary">Voice policy saved.</p>}{!data?<p role="status">{error?'Voice policy unavailable.':'Loading voice policy…'}</p>:<>
 <form onSubmit={save} className="space-y-3" aria-label="Voice policy">
 <div className="grid items-start gap-3" style={policyGrid}>
  <AdminFormField label="Environment availability" as="div">{editing?<label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="admin-checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/> Enable Staging voice</label>:<p className="py-2"><Badge tone={data.policy.enabled?'success':'neutral'}>{data.policy.enabled?'Development voice enabled':'Voice disabled'}</Badge></p>}</AdminFormField>
  <AdminFormField label="Maximum session (seconds)" as={editing?'label':'div'}>{editing?<input className="control" type="number" min="30" max="180" required disabled={busy} value={seconds} onChange={e=>setSeconds(e.target.valueAsNumber)}/>:<p className="py-2 text-sm tabular-nums">{data.policy.max_seconds} seconds</p>}</AdminFormField>
  <AdminFormField label="Concurrent environment sessions" as={editing?'label':'div'}>{editing?<input className="control" type="number" min="1" max="8" required disabled={busy} value={concurrency} onChange={e=>setConcurrency(e.target.valueAsNumber)}/>:<p className="py-2 text-sm">{data.policy.max_concurrent_sessions} slots · 1 per user</p>}</AdminFormField>
  <AdminFormField label="Optional daily sessions per user" as={editing?'label':'div'}>{editing?<input className="control" type="number" min="0" max="100" disabled={busy} placeholder="No daily limit" value={daily} onChange={e=>setDaily(e.target.value)}/>:<p className="py-2 text-sm">{data.policy.per_user_daily_sessions??'No daily limit'}</p>}</AdminFormField>
 </div>
 {editing&&<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{resetDraft(data.policy);setEditing(false);}}>Cancel</button><button className="btn-primary" disabled={busy}>Save limits</button></div>}
 </form>
 <p className="text-xs text-text-secondary">No fixed evaluation allowance. Provider billing and rate limits still apply. Text remains available.</p>
 <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Your availability &amp; safety controls</summary><div className="mt-2 space-y-2"><p>{availability[data.state]||'Availability not supplied'}. {data.reset_condition}</p><p>{data.policy.approval_required?'This environment requires approval.':'No individual approval is required by this policy.'} Expired and revoked sessions are closed by the server cleanup worker.</p><p>Production voice remains disabled until separately approved; this page does not activate it.</p></div></details>
 <div className="space-y-3 border-t border-border pt-4"><div><h4 className="text-sm font-semibold">Recent voice usage</h4><p className="mt-1 text-xs text-text-secondary">{data.can_edit?'Environment sessions':'Your sessions'} · Latest {data.sessions.length} records returned, not a billing-cycle total. Summaries follow the filters.</p></div>
 <AdminSummaryGrid variant="compact" ariaLabel="Filtered voice usage summary" items={[
  {key:'sessions',label:'Sessions',value:summary.count,helper:Object.entries(summary.states).map(([state,count])=>`${count} ${statuses[state]?.toLowerCase()||state}`).join(' · ')||'No matching records',helperClassName:'whitespace-normal'},
  {key:'duration',label:'Recorded duration',value:summary.duration.value===null?'Unavailable':`${summary.duration.value}s`,helper:`${summary.duration.coverage}/${summary.count} records · server call lifetime`},
  {key:'audio',label:'Audio tokens · in / out',value:`${summary.inputAudio.value===null?'—':usageNumber(summary.inputAudio.value)} / ${summary.outputAudio.value===null?'—':usageNumber(summary.outputAudio.value)}`,helper:`Coverage: ${summary.inputAudio.coverage}/${summary.count} in · ${summary.outputAudio.coverage}/${summary.count} out`},
  {key:'cost',label:'Estimated cost',value:'Unavailable',helper:`${summary.cost.coverage}/${summary.count} records support attribution`},
 ]}/>
 <AdminFilterToolbar compact denseFields presentation="inline" search={<AdminSearchField label="Search sessions" value={search} onChange={setSearch} placeholder="User, session or end reason"/>} filters={<><SelectField label="Status" value={status} onChange={setStatus} options={[{value:'all',label:'All'},...Object.entries(statuses).map(([value,label])=>({value,label}))]}/><SelectField label="Provider" value={provider} onChange={setProvider} options={[{value:'all',label:'All'},{value:'openai',label:'OpenAI'},{value:'grok',label:'Grok'}]}/></>} onClear={()=>{setStatus('all');setProvider('all');setSearch('');}} activeFilters={[...(status!=='all'?[{key:'status',label:'Status',value:statuses[status],onRemove:()=>setStatus('all')}]:[]),...(provider!=='all'?[{key:'provider',label:'Provider',value:provider,onRemove:()=>setProvider('all')}]:[]),...(search?[{key:'search',label:'Search',value:search,onRemove:()=>setSearch('')}]:[])]}/>
 <p className="text-xs text-text-secondary" role="status">{rows.length} of {data.sessions.length} sessions</p>
 {rows.length?<DataTable rows={rows} columns={columns} getRowKey={s=>s.request_id} density="compact" mobileLayout="stack" minWidth={760}/>:<p className="py-4 text-sm text-text-secondary">{data.sessions.length?'No sessions match these filters.':'No voice sessions recorded.'}</p>}
 <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Usage coverage &amp; cost attribution</summary><div className="mt-2 space-y-2"><p>Duration is server call lifetime, not speaking time. Audio totals are browser-reported provider observations; missing values are not zero. These records do not contain complete model-specific text/cache usage or historical pricing.</p><p>Current model prices cannot be applied retrospectively without that evidence. Estimated Cost requires a recorded model, complete billable usage and verified applicable pricing with a version and currency. It is never a provider-billed charge.</p></div></details>
 </div>
 </>}
 </section>;
}
