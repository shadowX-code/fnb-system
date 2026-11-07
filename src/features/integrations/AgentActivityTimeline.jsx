import {useEffect,useMemo,useRef,useState} from 'react';
import {Eye,FileCheck,ShieldAlert,Settings} from 'lucide-react';
import Timeline from '../../components/ui/Timeline.jsx';
import AdminUnderlineTabs from '../../components/navigation/AdminUnderlineTabs.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import FeedXDateRangePicker from '../../components/ui/FeedXDateRangePicker.jsx';
import AdminPagination,{useAdminClientPagination} from '../../components/tables/AdminPagination.jsx';
import {operationalDateKey} from '../../lib/dateTime.js';
import {agentBusinessModule} from './agentBusinessModule.js';
import {externalAgentService} from '../../services/externalAgentService.js';
import {agentActivity} from './agentActivity.js';

const states={committed:'Completed',configuration_changed:'Configuration changed',read:'Read succeeded',denied:'Denied',failed:'Failed',accepted:'API accepted',checked:'Eligibility checked',connection:'Connection check',pending_approval:'Pending Human Approval',awaiting_execution:'Awaiting Agent Execution',needs_resolution:'Needs Resolution',legacy_pending:'Legacy Pending Request',expired:'Expired',unproven:'Completion unverified'};
const moduleLabel=id=>agentBusinessModule(id)?.label||(id==='ai_integrations'?'AI Integrations':'Business module');
function ActivityEntries({entries,storageKey,resetKey}) {
 const pagination=useAdminClientPagination(storageKey,entries.length,20,resetKey);
 const events=entries.slice(pagination.from,pagination.to).map(entry=>({id:entry.id,date:entry.date,title:entry.category==='read'&&entry.moduleIds.length?`Read ${entry.moduleIds.map(moduleLabel).join(' / ')} records`:entry.title,
  icon:entry.category==='failed'?ShieldAlert:entry.state==='configuration_changed'?Settings:entry.category==='read'?Eye:FileCheck,
  description:<><span>{entry.moduleIds.length?entry.moduleIds.map(moduleLabel).join(' · '):'Business module not recorded'}</span>{entry.target&&<span className="block break-all">Record reference: {entry.target}</span>}</>,
  status:states[entry.state]||'Outcome unavailable',statusTone:entry.state==='committed'||entry.state==='read'?'success':entry.category==='failed'?'danger':'neutral',
  metadata:<><p>{entry.impact}</p>{entry.target&&entry.evidenceVisible&&agentBusinessModule(entry.moduleIds[0])?.route&&<a className="inline-block mt-1 underline" href={agentBusinessModule(entry.moduleIds[0]).route}>Open {moduleLabel(entry.moduleIds[0])} records</a>}</>,
  actions:<details className="min-w-0 w-full"><summary>Diagnostics &amp; evidence</summary><p className="text-xs text-text-secondary">Original event/operation identifiers are retained. Missing historical correlation is not reconstructed.</p><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry.diagnostics,null,2)}</pre></details>,
 }));
 return <><Timeline events={events} variant="activity" groupByDate timeZone="Asia/Kuala_Lumpur" empty="No activity matches these filters."/><AdminPagination page={pagination.page} pageSize={pagination.pageSize} total={entries.length} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} compact noun="entries"/></>;
}
export default function AgentActivityTimeline({agent,detail,onRefresh,canReadOperations=agent.can_manage}) {
 const [requests,setRequests]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('all'),[module,setModule]=useState('all'),[range,setRange]=useState({from:'',to:''}),[diagnosticsOpen,setDiagnosticsOpen]=useState(false);
 const generation=useRef(0),busy=useRef(false);
 useEffect(()=>{
  const current=++generation.current;setRequests([]);setError('');setFilter('all');setModule('all');setRange({from:'',to:''});
  if(canReadOperations){setLoading(true);externalAgentService.actionRequests(agent.id).then(value=>{if(current===generation.current)setRequests(value);}).catch(()=>{if(current===generation.current)setError('Business operation history is unavailable. Existing access and configuration history remain visible.');}).finally(()=>{if(current===generation.current)setLoading(false);});}else setLoading(false);
  return()=>{generation.current++;};
 },[agent.id,canReadOperations]);
 async function refresh(){if(busy.current)return;busy.current=true;const current=generation.current;setLoading(true);setError('');try{await onRefresh();if(canReadOperations){const data=await externalAgentService.actionRequests(agent.id);if(current===generation.current)setRequests(data);}}catch{if(current===generation.current)setError('Latest activity could not be loaded. Showing the last successful read.');}finally{busy.current=false;if(current===generation.current)setLoading(false);}}
 const projection=useMemo(()=>agentActivity(detail,requests,agent.id),[detail,requests,agent.id]);
 const modules=[...new Set([...projection.events,...projection.diagnostics].flatMap(entry=>entry.moduleIds))];
 const matches=entry=>{const date=operationalDateKey(entry.date);return (module==='all'||entry.moduleIds.includes(module))&&(!range.from||date>=range.from)&&(!range.to||date<=range.to);};
 const entries=projection.events.filter(entry=>(filter==='all'||entry.category===filter)&&matches(entry));
 const diagnostics=projection.diagnostics.filter(matches);
 const resetKey=JSON.stringify([agent.id,filter,module,range]);
 return <section aria-label="Agent Activity Timeline" className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="external-agent-heading">Agent Activity Timeline</h3><button className="btn-secondary" type="button" disabled={loading} onClick={refresh}>Refresh activity</button></div>
  <AdminUnderlineTabs value={filter} onChange={setFilter} ariaLabel="Activity filter" tabs={[{value:'all',label:'All'},{value:'changes',label:'Changes'},{value:'read',label:'Read'},{value:'failed',label:'Failed'}]}/>
  <AdminFilterToolbar compact presentation="inline" ariaLabel="Activity filters" period={<FeedXDateRangePicker from={range.from} to={range.to} today={operationalDateKey(new Date())} onApply={setRange}/>} filters={<SelectField label="Module" value={module} onChange={setModule} options={[{value:'all',label:'All modules'},...modules.map(id=>({value:id,label:moduleLabel(id)}))]}/>} onClear={()=>{setRange({from:'',to:''});setModule('all');setFilter('all');}}/>
  {error&&<p role="alert" className="external-agent-notice">{error}</p>}
  {loading&&<p role="status">Loading business operation history…</p>}
  {!canReadOperations&&<p className="text-xs text-text-secondary">Saved business-operation evidence requires the existing Agent-management authority. Your available read and configuration activity is shown below.</p>}
  <ActivityEntries entries={entries} storageKey="agent-business-activity" resetKey={resetKey}/>
  <details open={diagnosticsOpen} onToggle={event=>setDiagnosticsOpen(event.currentTarget.open)}><summary>Technical diagnostics &amp; uncorrelated history ({diagnostics.length})</summary>{diagnosticsOpen&&<div className="pt-3 space-y-3"><p className="text-sm text-text-secondary">Checks and API processing are not business completion. These events have no recorded operation ID and remain separate.</p><ActivityEntries entries={diagnostics} storageKey="agent-activity-diagnostics" resetKey={resetKey}/></div>}</details>
  <p className="text-xs text-text-secondary">Existing source windows: latest 50 access events, 50 configuration events and 50 completed receipts, plus saved open requests. Pagination covers returned evidence; older records remain in their canonical audit sources. Historical targets, result counts and correlations are shown only when recorded.</p>
  <p className="text-xs text-text-secondary">{detail.history_note} {detail.management_history_note}</p>
 </section>;
}
