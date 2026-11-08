import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {formatOperationalDateTime} from '../../lib/dateTime.js';
import {marketingService} from './marketingService.js';
import {resolveBrandContext} from './brandContext.js';

const scenarios = [
 {value:'no_reply',label:'No customer reply'},
 {value:'details',label:'Customer asks for details'},
 {value:'human',label:'Customer asks for staff'},
 {value:'opted_out',label:'Already opted out'},
 {value:'undelivered',label:'Delivery failed'},
 {value:'uncertain',label:'Unknown submission result'},
 {value:'goal_completed',label:'Goal completed'},
 {value:'consent_revoked',label:'Consent withdrawn while waiting'},
];
const initial = {title:'',batch_size:30,follow_up_hours:24};
const labels = {draft:'Draft',enabled:'Enabled for simulation',paused:'Paused',save:'Saved revision',enable:'Enabled for simulation',pause:'Paused',simulate:'Simulation'};
export default function WhatsAppWorkflowsPage(){
 const auth=useAuth();
 const [context,setContext]=useState(null),[brand,setBrand]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;setContext(null);setBrand('');setError('');
  marketingService.context().then(value=>{
   if(!active)return;
   setContext(value);
   const requested=new URLSearchParams(window.location.search).get('marketing_brand');
   setBrand(resolveBrandContext(value,requested||value.brands[0]?.id).brand);
  }).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[auth.user?.id]);
 const scope=context?.brands.find(row=>row.id===brand);
 return <WorkspacePage section="Marketing" title="Workflows" description="Configure and test a WhatsApp campaign follow-up."
  controls={<SelectField label="Brand" value={brand} onChange={setBrand} disabled={!context} options={(context?.brands||[]).map(row=>({value:row.id,label:row.name}))}/>}>
   {error?<p role="alert" className="text-danger">{error}</p>:null}
   {scope?<WorkflowWorkspace key={`${auth.user?.id}:${brand}`} org={scope.organization_id} brand={brand}
    canEdit={auth.hasPermission('marketing_campaigns.manage')} canExecute={auth.hasPermission('marketing_campaigns.execute')}/>:
    !error?<EmptyState title={context?'No accessible Brand':'Loading Brands…'}/>:null}
 </WorkspacePage>;
}

function WorkflowWorkspace({org,brand,canEdit,canExecute}){
 const [data,setData]=useState(null),[selected,setSelected]=useState(''),[form,setForm]=useState(initial);
 const [refresh,setRefresh]=useState(0),[scenario,setScenario]=useState('no_reply'),[trace,setTrace]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState('');
 const [notice,setNotice]=useState('');
 const inFlight=useRef(false),pending=useRef(null);
 useEffect(()=>{
  let active=true;setLoadError('');
  Promise.all([
   marketingService.whatsappWorkflows(org,brand),
   selected?marketingService.whatsappWorkflows(org,brand,selected):null,
  ]).then(([list,detail])=>{
   if(!active)return;
   const record=detail?.rows[0]||null;
   setData({selected,list:list.rows,record,history:detail?.history||[]});setForm(record||initial);
  }).catch(failure=>{if(active)setLoadError(failure.message);});
  return()=>{active=false;};
 },[org,brand,selected,refresh]);
 const loaded=data?.selected===selected;
 const record=loaded?data.record:null;
 const editable=loaded&&canEdit&&record?.state!=='enabled'&&!busy&&!loadError;
 const dirty=form.title!==(record?.title||'')||String(form.batch_size)!==String(record?.batch_size??initial.batch_size)||form.follow_up_hours!==(record?.follow_up_hours??initial.follow_up_hours);
 function choose(id){
  setSelected(id);setTrace(null);setError('');setNotice('');
 }
 async function command(action){
  if(inFlight.current||!loaded)return;
  const input={org,brand,workflow:record?.id||null,revision:record?.revision||0,action,
   ...(action==='save'?{title:form.title,batch:Number(form.batch_size),wait:form.follow_up_hours}:{}),
   ...(action==='simulate'?{scenario}:{}),
  };
  const fingerprint=JSON.stringify(input);
  if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};
  inFlight.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await marketingService.whatsappWorkflowCommand({...input,request:pending.current.id});
   pending.current=null;setSelected(result.id);setRefresh(value=>value+1);
   setTrace(result.trace||null);setNotice(action==='simulate'?'Simulation recorded.':action==='save'?'Draft saved.':labels[action]);
  }catch(failure){setError(failure.message);}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,3fr)]">
  <aside className="card space-y-3 p-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h2>Brand workflows</h2>{canEdit?<button className="btn-secondary" type="button" disabled={busy||dirty} onClick={()=>choose('')}>New workflow</button>:null}</div>
   {data?.list.length?data.list.map(item=><button type="button" className="btn-secondary w-full justify-between text-left" key={item.id}
    aria-pressed={selected===item.id} disabled={busy||dirty} onClick={()=>choose(item.id)}><span className="min-w-0 break-words">{item.title}</span><Badge>{labels[item.state]}</Badge></button>):
    <EmptyState title="No workflows yet" description="Save an invitation and follow-up workflow to begin."/>}
  </aside>
  <div className="space-y-4">
   <section className="card space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2>{record?'Workflow configuration':'New workflow'}</h2><Badge tone="info">Simulation only</Badge></div>
    <p className="text-sm">Runs use fictional recipients. Enabling this revision does not send WhatsApp messages or start a campaign.</p>
    <AsyncDataSurface loading={!loaded&&!loadError} error={loadError} hasData={Boolean(loaded)} onRetry={()=>setRefresh(value=>value+1)}>
     {loaded?<form className="space-y-4" onSubmit={event=>{event.preventDefault();if(editable&&dirty)command('save');}}>
      <AdminFormField label="Workflow name" required><input className="control" value={form.title} maxLength={120} required disabled={!editable}
       onChange={event=>setForm(value=>({...value,title:event.target.value}))}/></AdminFormField>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
       <li><strong>Campaign starts</strong><p>Eligible recipients enter the workflow.</p></li>
       <li><strong>Initial template</strong><AdminFormField label="Recipients per batch"><input type="number" min="1" max="100" step="1" className="control" required value={form.batch_size} disabled={!editable}
        onChange={event=>setForm(value=>({...value,batch_size:event.target.value}))}/></AdminFormField></li>
       <li><strong>Branch on the result</strong><p>Customer reply opens the campaign conversation. A request for staff goes to the human queue. Failed or uncertain delivery stops the reminder.</p></li>
       <li><strong>No reply</strong><SelectField label="Reminder wait" value={String(form.follow_up_hours)} disabled={!editable}
        options={[0,24,48,72].map(hours=>({value:String(hours),label:hours?`After ${hours} hours`:'No reminder'}))}
        onChange={value=>setForm(current=>({...current,follow_up_hours:Number(value)}))}/><p>Send at most one reminder, subject to eligibility and consent at that time.</p></li>
      </ol>
      {canEdit&&record?.state!=='enabled'?<div className="flex flex-wrap gap-2">
       <button type="submit" className="btn-primary" disabled={!editable||!dirty||!form.title.trim()}>{busy?'Working…':'Save draft'}</button>
       {dirty?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setForm(record||initial)}>Discard changes</button>:null}
      </div>:null}
     </form>:null}
    </AsyncDataSurface>
   </section>
   {record?<section className="card space-y-3 p-4">
    <h2>Simulation and history</h2>
    <div className="flex flex-wrap items-end gap-2">
     {canEdit?<><SelectField label="Scenario" value={scenario} onChange={setScenario} disabled={busy||dirty} options={scenarios}/>
      <button type="button" className="btn-secondary" disabled={busy||dirty} onClick={()=>command('simulate')}>Run simulation</button></>:null}
     {canExecute?<button type="button" className="btn-secondary" disabled={busy||dirty||(record.state!=='enabled'&&!data.history.some(item=>item.action==='simulate'&&item.revision===record.revision))}
      onClick={()=>command(record.state==='enabled'?'pause':'enable')}>{record.state==='enabled'?'Pause':'Enable for simulation'}</button>:null}
    </div>
    {trace?<ol className="list-decimal space-y-2 pl-5 text-sm" aria-label="Simulation steps">{trace.map(item=><li key={item.step}><strong>{item.step}</strong> · {item.result}</li>)}</ol>:null}
    <ul className="space-y-2">{data.history.map(item=><li key={item.id} className="text-sm">
     <details><summary>{labels[item.action]} · Revision {item.revision} · {item.actor_name} · {formatOperationalDateTime(item.created_at)} MYT</summary>
      <p>{item.title} · Batch {item.batch_size} · {item.follow_up_hours?`Wait ${item.follow_up_hours}h`:'No reminder'}</p>
      {item.scenario?<p>{scenarios.find(s=>s.value===item.scenario)?.label}</p>:null}
      {item.trace?<ol className="list-decimal pl-5">{item.trace.map(step=><li key={step.step}>{step.step} · {step.result}</li>)}</ol>:null}
     </details></li>)}</ul>
   </section>:null}
   {notice?<p role="status">{notice}</p>:null}
   {error?<p role="alert" className="text-danger">{error}</p>:null}
  </div>
 </div>;
}
