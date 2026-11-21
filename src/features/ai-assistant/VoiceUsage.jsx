import {useState,useCallback} from 'react';
import {assistantCall} from './nativeAssistantService.js';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import {useAssistantSettingsQuery} from './useAssistantSettingsQuery.js';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalMoment} from '../../lib/dateTime.js';
import {usageNumber,formatVoiceCost,formatVoiceDuration,voiceCostCoverage} from './voiceUsageSummary.js';

const statuses={reserved:'Reserved',connecting:'Connecting',active:'Active',closing:'Closing',closed:'Closed',failed:'Failed',historical:'Historical evaluation'};
const availability={available:'Available to start',disabled:'Disabled by Admin',active_elsewhere:'Session already active',approval_required:'Approval required by policy',daily_limit:'Daily limit reached',capacity:'Environment at capacity'};
const periods = [{value:'month',label:'This month'},{value:'7d',label:'Last 7 days'},{value:'30d',label:'Last 30 days'},{value:'all',label:'All time'}];
const billingUrl = 'https://platform.openai.com/settings/organization/billing/overview';
const sessionKey = session => `${session.actor}:${session.request_id}`;
const policyGrid={gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 190px), 1fr))'};
function activeSessionDeadline(data) {
 return (data?.sessions ?? []).reduce((deadline, session) => {
  if (!['reserved','connecting','active','closing'].includes(session.state)) return deadline;
  const started=Date.parse(session.created_at), expires=Date.parse(session.expires_at);
  if (!Number.isFinite(started)) return deadline;
  // One final reading near expiry leaves the terminal state and final metering visible.
  const end=Number.isFinite(expires)?Math.min(expires+30000,started+270000):started+240000;
  return Math.max(deadline,end);
 },0);
}

const providers = {openai:'OpenAI',grok:'Grok'};
const endReasons = {
 user_ended:'Ended by user', provider_rejected:'Provider rejected', startup_expired:'Start expired',
 admin_disabled:'Admin disabled', duration_expired:'Time limit', heartbeat_expired:'Heartbeat lost',
 unknown_connection_expired:'Unconfirmed start expired',
};

export default function VoiceUsage({onSaved}={}){
 const [saveError,setSaveError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[enabled,setEnabled]=useState(false),[daily,setDaily]=useState(''),[seconds,setSeconds]=useState(180),[concurrency,setConcurrency]=useState(4);
 const [period,setPeriod]=useState('month'),[status,setStatus]=useState('all'),[page,setPage]=useState(1),[saved,setSaved]=useState(false);
 const read=useCallback(async signal=>{
  const result=await assistantCall('voice_usage',{period,status,page},signal);
  if(!result?.policy||!Array.isArray(result.sessions)||!result.summary)throw new Error('Voice usage is unavailable.');
  return result;
 },[period,status,page]);
 const {data,error,loading,refresh}=useAssistantSettingsQuery(`${period}:${status}:${page}`,read,{
  paused:editing||busy,pollUntil:activeSessionDeadline,
 });
 function resetDraft(policy){setEnabled(policy.enabled);setDaily(policy.per_user_daily_sessions??'');setSeconds(policy.max_seconds);setConcurrency(policy.max_concurrent_sessions);}
 async function save(e){
  e.preventDefault();
  if(!editing||!data?.can_edit||data.environment!=='staging'||busy)return;
  setBusy(true);setSaveError('');setSaved(false);
  try{
   await assistantCall('voice_policy_save',{revision:data.policy.revision,enabled,maximum_seconds:seconds,concurrency,daily_sessions:daily===''?null:Number(daily)});
   const refreshed=await refresh();
   setEditing(false);
   if(refreshed){setSaved(true);await onSaved?.();}
  }catch(e){setSaveError(e.message);}finally{setBusy(false);}
 }
 const current = !!data;
 const rows = current ? data.sessions : [];
 const summary = current ? data.summary : null;
 const filteredCount = current ? data.filtered_count : 0;
 const totalPages = Math.max(1,Math.ceil(filteredCount/(data?.page_size||30)));
 const amount = formatVoiceCost(summary?.cost_nano_usd);
 const attributed = summary && summary.estimated_sessions + summary.partial_sessions;
 const columns=[
  {key:'created_at',header:'Started',width:'22%',mobileSpan:2,render:s=><span className="tabular-nums">{formatOperationalMoment(s.created_at)}</span>},
  {key:'provider',header:'Provider',width:'11%',render:s=>providers[s.provider]??s.provider??'—'},
  {key:'state',header:'Status',width:'14%',render:s=><Badge tone={s.state==='failed'?'danger':s.state==='active'?'success':'neutral'}>{statuses[s.state||'historical']||s.state}</Badge>},
  {key:'duration',header:'Duration',width:'11%',align:'right',render:s=><span className="tabular-nums">{formatVoiceDuration(s.observed_duration_seconds)}</span>},
  {key:'audio',header:'Audio tokens (in / out)',width:'17%',align:'right',render:s=>{
   const input=usageNumber(s.observed_usage?.input_audio_tokens),output=usageNumber(s.observed_usage?.output_audio_tokens);
   return <span className="tabular-nums">{input==='—'&&output==='—'?'—':`${input} / ${output}`}</span>;
  }},
  {key:'cost',header:'Estimated cost',width:'12%',align:'right',render:s=>{
   const cost=voiceCostCoverage(s);
   if(cost.state==='unavailable')return <span aria-label="Cost unavailable">—</span>;
   if(cost.state==='partial')return <span className="tabular-nums" aria-label={`${cost.amount}, partial estimate`}>{cost.amount}*</span>;
   return <span className="tabular-nums">{cost.amount}</span>;
  }},
  {key:'reason',header:'End reason',width:'13%',render:s=>s.reason?(endReasons[s.reason]??s.reason.replaceAll('_',' ')):'—'},
 ];
 return <section className="min-w-0 space-y-4" aria-label="Voice usage management">
 <section aria-labelledby="voice-usage-overview">
  <h3 id="voice-usage-overview" className="text-sm font-semibold">Usage Overview</h3>
  {error&&<div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-rose-700">{error}
   <button type="button" className="btn-secondary" disabled={busy||loading} onClick={()=>void refresh()}>Retry usage</button>
  </div>}
  {current&&<p className="mt-1 text-xs text-text-secondary">
   {periods.find(option=>option.value===period)?.label} · {data.can_edit?'Staging environment':'Your sessions'}
   {data.period_start?` · Since ${formatOperationalMoment(data.period_start)}`:''} · As of {formatOperationalMoment(data.as_of)}
  </p>}
  <AdminSummaryGrid variant="compact" mobileColumns={2} className="mt-2 lg:grid-cols-4" ariaLabel="Voice usage KPIs" items={[
   {key:'cost',label:'Estimated Cost',value:summary?amount:'—',helper:summary?`${attributed>0&&summary.estimated_sessions<summary.sessions?'Partial subtotal · ':''}${summary.estimated_sessions} estimated · ${summary.partial_sessions} partial · ${summary.sessions-attributed} unavailable`:null,helperClassName:'whitespace-normal'},
   {key:'sessions',label:'Sessions',value:summary?.sessions??'—',helper:'All statuses in period'},
   {key:'duration',label:'Connected Duration',wrapLabel:true,value:summary?formatVoiceDuration(summary.duration_seconds,'Unavailable'):'—',helper:summary?`${summary.duration_sessions}/${summary.sessions} sessions timed`:null},
   {key:'credits',label:'API Credits',value:'Not connected',valueClassName:'text-base font-semibold',helper:<a className="text-primary-ink underline" href={billingUrl} target="_blank" rel="noreferrer">OpenAI Billing</a>},
  ]}/>
  <p className="mt-2 text-xs text-text-secondary">Provider charges are reconciled in OpenAI Billing. Duration measures connected call time.</p>
 </section>
 {loading&&!data&&<p role="status" className="text-xs text-text-secondary">Loading voice usage…</p>}
 {data&&<section aria-labelledby="voice-policy-heading">
 <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
   <h3 id="voice-policy-heading" className="text-sm font-semibold">Voice Policy · {data.environment==='staging'?'Staging':data.environment}</h3>
   <Badge tone={data.policy.enabled?'success':'neutral'}>{data.policy.enabled?'Development voice enabled':'Voice disabled'}</Badge>
   {!editing&&<p className="text-xs text-text-secondary">{formatVoiceDuration(data.policy.max_seconds)} max · {data.policy.max_concurrent_sessions} concurrent · 1 at a time per user · {data.policy.per_user_daily_sessions===null?'No daily limit':`${data.policy.per_user_daily_sessions} per user daily`}</p>}
  </div>
  {data.can_edit&&data.environment==='staging'&&!editing&&<button type="button" className="btn-secondary" disabled={loading||!!error} onClick={()=>{resetDraft(data.policy);setEditing(true);setSaved(false);setSaveError('');}}>Edit policy</button>}
 </div>
 {saveError&&<p role="alert" className="text-sm text-rose-700">{saveError}</p>}
 {saved&&<p role="status" className="text-sm text-text-secondary">Voice policy saved.</p>}
 {editing&&<form onSubmit={save} className="mt-2 space-y-3" aria-label="Voice policy">
  <div className="grid items-start gap-3" style={policyGrid}>
   <AdminFormField label="Environment availability" as="div"><label className="inline-flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="admin-checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/> Enable Staging voice</label></AdminFormField>
   <AdminFormField label="Maximum session (seconds)" as="label"><input className="control" type="number" min="30" max="180" required disabled={busy} value={seconds} onChange={e=>setSeconds(e.target.valueAsNumber)}/></AdminFormField>
   <AdminFormField label="Concurrent environment sessions" as="label"><input className="control" type="number" min="1" max="8" required disabled={busy} value={concurrency} onChange={e=>setConcurrency(e.target.valueAsNumber)}/></AdminFormField>
   <AdminFormField label="Optional daily sessions per user" as="label"><input className="control" type="number" min="0" max="100" disabled={busy} placeholder="No daily limit" value={daily} onChange={e=>setDaily(e.target.value)}/></AdminFormField>
  </div>
  <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setEditing(false);setSaveError('');}}>Cancel</button><button className="btn-primary" disabled={busy}>Save limits</button></div>
 </form>}
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
   {rows.length?<><DataTable rows={rows} columns={columns} getRowKey={sessionKey} density="compact" columnSpacing="compact"
    mobileLayout="two-line" minWidth={620} tableClassName="[--admin-table-row-min-height:46px]" getRowClassName={()=>'h-[46px] max-[700px]:h-auto'}/>
    <p className="text-xs text-text-secondary">Estimated costs use recorded usage and USD list rates. A dash indicates missing attribution, including historical audio-only reports. * Partial estimate.</p>
   </>:<p className="py-3 text-sm text-text-secondary">No sessions match these filters on this page.</p>}
   {totalPages>1&&<div className="flex items-center justify-end gap-2">
    <button type="button" className="btn-secondary" disabled={page<=1||editing||busy} onClick={()=>{setPage(page-1);}}>Previous</button>
    <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
    <button type="button" className="btn-secondary" disabled={page>=totalPages||editing||busy} onClick={()=>{setPage(page+1);}}>Next</button>
   </div>}
  </>}
 </section>
 </section>;
}
