import {useState} from 'react';
import {getPermissionDefinitions} from '../../../config/modules.ts';
import {getAccessibleOutlets} from '../../utils/accessControl.js';
import Drawer from '../../components/ui/Drawer.jsx';
import Badge from '../../components/ui/Badge.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DatePickerField from '../../components/forms/DatePickerField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import {capabilityStatuses} from './assistantCapabilityPresentation.js';
const permissionLabels=new Map(getPermissionDefinitions().map(p=>[p.code,p.description]));
const label=k=>({outlet_id:'Outlet',organization_id:'Organization reference',brand_id:'Brand reference',employee_id:'Employee reference',legal_entity_id:'Legal entity reference',sop_id:'Published SOP reference',from:'From',to:'To',month:'Month',page:'Page',year:'Year'}[k]||k.replaceAll('_',' '));
export function diagnosticArguments(parameters,values){
 const args={};
 for(const [key,schema] of Object.entries(parameters)){
  const nullable=Array.isArray(schema.type)&&schema.type.includes('null'),type=Array.isArray(schema.type)?schema.type.find(t=>t!=='null'):schema.type,raw=values[key]??(key==='page'?'1':'');
  if(raw===''&&nullable){args[key]=null;continue;}
  const value=type==='number'?Number(raw):raw;
  if((raw===''&&type==='number')||typeof value!==type||type==='number'&&(!Number.isInteger(value)||value<schema.minimum||value>schema.maximum)||schema.pattern&&!new RegExp(schema.pattern).test(value)||schema.enum&&!schema.enum.includes(value)||schema.maxLength&&value.length>schema.maxLength)throw Error(`Choose a valid ${label(key).toLowerCase()}.`);
  if(type==='string'&&schema.pattern?.startsWith('^20')&&(!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error(`Choose a valid ${label(key).toLowerCase()}.`);
  args[key]=value;
 }
 if(args.from&&args.to&&(Date.parse(args.to)<Date.parse(args.from)||Date.parse(args.to)-Date.parse(args.from)>31*86400000))throw Error('Choose a date range of at most 31 days.');
 return args;
}
function Diagnostics({operation,outlets,busy,canEdit,onTest}){
 const [values,setValues]=useState({}),[open,setOpen]=useState(false);
 const parameters=operation.test_parameters||{};
 const update=(key,value)=>setValues(v=>({...v,[key]:value}));
 let args,error;try{args=diagnosticArguments(parameters,values);}catch(e){error=e.message;}
 return <details onToggle={e=>setOpen(e.currentTarget.open)} className="text-sm"><summary className="min-h-10 cursor-pointer py-2 text-text-secondary">Advanced Diagnostics</summary>{open&&<div className="space-y-3 pt-2">
  <p className="text-xs text-text-secondary">Runs this read with your current authority. No model call or business mutation.</p>
  <div className="grid min-w-0 gap-3 sm:grid-cols-2">{Object.entries(parameters).map(([key,schema])=>{
   const value=values[key]??(key==='page'?'1':''),nullable=Array.isArray(schema.type)&&schema.type.includes('null'),type=Array.isArray(schema.type)?schema.type.find(t=>t!=='null'):schema.type;
   const common={key,label:label(key),value,onChange:v=>update(key,v),disabled:busy};
   if(key==='outlet_id')return <SelectField {...common} options={[{value:'',label:nullable?'All authorized outlets':'Choose outlet'},...outlets.map(o=>({value:o.id,label:o.name}))]}/>;
   if(schema.enum)return <SelectField {...common} options={[{value:'',label:'Choose'},...schema.enum.map(v=>({value:v,label:v}))]}/>;
   if(type==='string'&&schema.pattern?.startsWith('^20'))return key==='month'?<MonthPickerField {...common} emptyLabel="Choose month" value={value.slice(0,7)} onChange={v=>update(key,v?v+'-01':'')}/>:<DatePickerField {...common}/>;
   if(key==='month'&&type==='number')return <SelectField {...common} options={[{value:'',label:'Choose month'},...Array.from({length:12},(_,i)=>({value:String(i+1),label:new Date(2026,i,1).toLocaleString('en-MY',{month:'long'})}))]}/>;
   return <label key={key} className="admin-form-field min-w-0"><span className="admin-form-field-label">{label(key)}</span><input className="input w-full min-w-0" aria-label={label(key)} type={type==='number'?'number':'text'} min={schema.minimum} max={schema.maximum} maxLength={schema.maxLength} value={value} onChange={e=>update(key,e.target.value)} disabled={busy}/>{schema.pattern?.includes('0-9a-f')&&<span className="text-xs text-text-secondary">Use an existing authorized record reference. No lookup is available here.</span>}</label>;
  })}</div>
  {error&&<p className="text-xs text-text-secondary">{error}</p>}
  {Object.hasOwn(parameters,'outlet_id')&&!outlets.length&&<p className="text-xs text-text-secondary">No individually selectable outlets are available in your current Admin scope.</p>}
  <button type="button" className="btn-secondary min-h-10" disabled={busy||!canEdit||operation.availability!=='connected'||!!error} onClick={()=>void onTest(args)}>Test Connection</button>
 </div>}</details>;
}
export default function AssistantCapabilityDetail({row,data,canEdit,busy,onFeature,onClose,auth,store}){
 const [feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false);
 const outlets=getAccessibleOutlets(auth,store?.outlets||[]);
 async function act(action,values){setFeedback('');setFailed(false);const r=await onFeature(action,values);if(r?.error){setFailed(true);setFeedback(r.error);}else if(r)setFeedback(action==='capability_test'?`Read verified · ${r.as_of}`:'Configuration saved.');}
 return <Drawer title={row.label} eyebrow={`${row.workspaceLabel} / ${row.domain}`} width="md" onClose={onClose}><div className="space-y-5">
  <div className="flex flex-wrap items-center gap-2"><Badge tone={row.status==='connected'?'success':row.status==='partial'?'warning':'neutral'}>{capabilityStatuses[row.status]}</Badge><span className="text-xs text-text-secondary">Connections never grant human permissions.</span></div>
  {feedback&&<p role={failed?'alert':'status'} className={failed?'text-sm text-red-700':'text-sm text-primary'}>{feedback}</p>}
  {['READ','ACTION'].map(kind=><section key={kind} aria-label={`${kind} capabilities`} className="space-y-3"><h3 className="text-xs font-semibold tracking-wide text-primary">{kind}</h3>{row.operations.filter(o=>o.kind===kind).length?row.operations.filter(o=>o.kind===kind).map(o=><article key={o.id} className="space-y-3 border-b border-border pb-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{o.label}</h4><Badge tone={o.connection_enabled?'success':'neutral'}>{o.connection_enabled?'Connected':'Disconnected'}</Badge></div>
   {o.module_id!==row.id&&<p className="text-xs text-text-secondary">Shared capability · connection changes apply in every module using this operation. Coverage is limited to the scope below.</p>}
   <dl className="space-y-2 text-sm"><div><dt className="font-medium">Scope</dt><dd className="text-text-secondary">{o.scope}</dd></div><div><dt className="font-medium">Human authorization</dt><dd className="text-text-secondary">{permissionLabels.get(o.permission)||o.permission}</dd><dd className="mt-1 text-xs text-text-secondary">{o.availability==='denied'?'Current user is not authorized.':o.availability==='connected'?'Current user verified by server.':'Checked again when the operation runs.'}</dd></div></dl>
   <button type="button" className="btn-secondary min-h-10" disabled={!canEdit||busy} onClick={()=>void act('capability_connection',{operation:o.id,enabled:!o.connection_enabled,expected_revision:data.config.revision})}>{o.connection_enabled?'Disconnect':'Connect'}</button>
   {kind==='ACTION'&&<div className="space-y-2"><p className="text-xs text-text-secondary">AI execution {o.ai_execution_enabled?'enabled':'disabled'}. Execution also requires current human authority and explicit confirmation of an unexpired preview. Connecting alone cannot execute an action.</p><button type="button" className="btn-secondary min-h-10" disabled={!canEdit||busy} onClick={()=>void act('action_policy',{operation:o.id,enabled:!o.ai_execution_enabled,expected_revision:data.config.revision})}>{o.ai_execution_enabled?'Disable AI execution':'Enable AI execution'}</button></div>}
   {kind==='READ'&&o.test_supported&&<Diagnostics operation={o} outlets={outlets} busy={busy} canEdit={canEdit} onTest={args=>act('capability_test',{operation:o.id,arguments:args})}/>}
  </article>):<p className="text-sm text-text-secondary">{kind==='READ'?'No registered READ integration. A domain-owned, authorized read contract is required before connection.':'No ACTION integration is implemented. No business mutation can be enabled here.'}</p>}</section>)}
  {row.sources.map(s=><div key={s.name} className="space-y-1 text-xs text-text-secondary"><p className="font-medium">{s.name} · {s.owner}</p><p>{s.access}</p><p>{s.version}</p><p>Only the registered operations above are retrievable. Other source content requires its own authorized integration; document access is not granted by connecting a capability.</p></div>)}
 </div></Drawer>;
}
