import {useEffect,useState} from 'react';
import Modal from '../feedback/Modal.jsx';
import SelectField from '../forms/SelectField.jsx';
import AdminMultiSelectGroup from '../forms/AdminMultiSelectGroup.jsx';
import AccessScopeSummary from './AccessScopeSummary.jsx';
import AccessChangeReview from './AccessChangeReview.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
import './moduleAccessSelector.css';
import {actionLabels,capabilityDomain,executionPolicyLabels} from './capabilityActions.js';

export {actionLabels} from './capabilityActions.js';
function businessRows(rows) {
 const modules=new Map();
 for(const row of rows){const key=row.workflow_id||row.module_id||row.name;if(!modules.has(key))modules.set(key,[]);modules.get(key).push(row);}
 const order=['view','create','update','submit','complete','verify','approve','confirm','receive','return_to_draft','cancel'];
 return [...modules].map(([key,entries])=>[key,entries.toSorted((a,b)=>order.indexOf(a.capability)-order.indexOf(b.capability))]);
}
export default function BusinessCapabilitySelector({capabilities=[],identityId=null,canManage=false,busy=false,onConfirmed,onConfirmRegistration,registration=false}) {
 const hasRestaurant=c=>c.workspace==='Restaurant';
 const restaurantAvailable=capabilities.some(hasRestaurant);
 const [scopeData,setScopeData]=useState(null),[scope,setScope]=useState({type:'none',outlet_ids:[]}),[scopeError,setScopeError]=useState('');
 useEffect(()=>{let active=true;setScopeData(null);setScopeError('');if(restaurantAvailable) externalAgentService.outletScope(identityId).then(data=>{if(active){setScopeData(data);setScope({type:data.scope.type,outlet_ids:data.scope.outlet_ids});}}).catch(()=>{if(active)setScopeError('Outlet access could not be loaded. Reopen access before reviewing Restaurant grants.');});return()=>{active=false;};},[identityId,restaurantAvailable]);
 const baseline=c=>!registration && !!c.granted;
 const [selected,setSelected]=useState(()=>capabilities.filter(baseline).map(c=>c.name));
 const [plan,setPlan]=useState(null),[working,setWorking]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setSelected(capabilities.filter(c=>!registration && c.granted).map(c=>c.name));setPlan(null);},[capabilities,registration]);
 const groups=new Map();
 for(const c of capabilities){const group=`${c.workspace||'Factory'} / ${capabilityDomain(c,capabilities)}`;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(c);}
 const chosen=c=>selected.includes(c.name);
 const restaurantSelected=capabilities.some(c=>hasRestaurant(c)&&chosen(c));
 const scopeKey=value=>JSON.stringify([value?.type,[...(value?.outlet_ids||[])].sort()]);
 const scopeChanged=restaurantSelected&&scopeData&&scopeKey(scope)!==scopeKey(scopeData.scope);
 const scoped=restaurantSelected||capabilities.some(c=>hasRestaurant(c)&&baseline(c));
 const scopeValid=!restaurantSelected||(scopeData&&!scopeError&&(scope.type==='all'||(scope.type==='selected'&&scope.outlet_ids.length>0)));
 const changed=capabilities.some(c=>baseline(c)!==chosen(c))||scopeChanged;
 async function review(){setWorking(true);setError('');try{setPlan(await (scoped?externalAgentService.reviewScoped(identityId,selected,scope):externalAgentService.review(identityId,selected)));}catch(e){setError(e.message);}finally{setWorking(false);}}
 async function confirm(){
  setWorking(true);setError('');
  try{if(registration)await onConfirmRegistration(selected,plan.review_hash,...(scoped?[scope]:[]));else {await (scoped?externalAgentService.confirmScoped(identityId,selected,scope,plan.review_hash):externalAgentService.confirmAccess(identityId,selected,plan.review_hash));await onConfirmed?.();if(scoped){const fresh=await externalAgentService.outletScope(identityId);setScopeData(fresh);setScope({type:fresh.scope.type,outlet_ids:fresh.scope.outlet_ids});}}setPlan(null);}
  catch(e){setError(e.message);setPlan(null);}finally{setWorking(false);}
 }
 return <div className="space-y-3">
  <p className="text-xs text-text-secondary">Select access, review changes, then confirm. Related full records and optional reporting sources are never granted automatically.</p>
  {error&&<p role="alert" className="external-agent-notice">{error}</p>}
  {[...groups].map(([group,rows])=><details className="module-access-group" key={group}>
   <summary>{group}<span className="module-access-count">{rows.filter(chosen).length} of {rows.length} selected</span></summary>
   <ul>{businessRows(rows).map(([key,entries])=>{const owner=entries.find(c=>c.capability==='view')||entries[0];return <li key={key}><div className="module-access-main">
    <div className="module-access-row flex-wrap"><strong>{owner.label}{owner.capability_limitation&&<span className="module-access-related"> · Limited</span>}</strong>
     <div className="flex flex-wrap gap-x-4 gap-y-2">{entries.map(c=><div key={c.name}>
      <label className="module-access-view"><input type="checkbox" aria-label={`${actionLabels[c.capability]||c.capability}: ${c.label}`} checked={chosen(c)} disabled={busy||working||!canManage||!c.can_assign||(!c.implemented&&!c.granted)} onChange={e=>{setSelected(previous=>e.target.checked?[...previous,c.name]:previous.filter(n=>n!==c.name));setPlan(null);}}/>{actionLabels[c.capability]||c.capability}</label>
      {c.read_only===false&&<p className="text-xs text-text-secondary"><span className="block">Effective grant: {baseline(c)?'Granted':'Restricted'}</span>{baseline(c)!==chosen(c)&&<span className="block font-medium">Pending: {chosen(c)?'Grant access':'Remove access'}</span>}<span className="block">{executionPolicyLabels[c.execution_policy] || (c.requires_human_approval?'Human confirmation required':'Autonomous execution')}</span>{baseline(c)&&c.view_granted===false&&<span className="block">Business-module View required</span>}</p>}
     </div>)}</div>
    </div>{entries.map(c=><AccessScopeSummary key={c.name} capability={c} catalog={capabilities}/>)}
   </div></li>;})}</ul>
  </details>)}
  {restaurantSelected&&<section aria-label="Restaurant outlet access" className="space-y-2"><h3 className="text-sm font-semibold">Restaurant outlet access</h3><p className="text-xs text-text-secondary">Uses the Agent role’s canonical outlet scope. New grants never imply All Outlets. Changes remain staged until confirmation.</p>{scopeError?<p role="alert">{scopeError}</p>:!scopeData?<p role="status">Loading authorized outlets…</p>:<><SelectField label="Outlet access" value={scope.type} disabled={busy||working||!canManage} options={[{value:'none',label:'Choose outlet access'},{value:'selected',label:'Selected Outlets'},...(scopeData.can_assign_all?[{value:'all',label:'All Outlets — current and future'}]:[])]} onChange={type=>{setScope({type,outlet_ids:type==='selected'?scope.outlet_ids:[]});setPlan(null);}}/>{scope.type==='selected'&&<AdminMultiSelectGroup label="Authorized outlets" value={scope.outlet_ids} options={scopeData.outlets} disabled={busy||working||!canManage} onChange={outlet_ids=>{setScope({type:'selected',outlet_ids});setPlan(null);}}/>}</>}</section>}
  <button type="button" className="btn-primary" disabled={!scopeValid||busy||working||!canManage||(!registration&&!changed)||(registration&&!selected.length)} onClick={review}>{working?'Preparing review…':'Review Changes'}</button>
  {changed&&!plan&&<p className="text-xs text-text-secondary">Selections are staged. Effective access is unchanged until confirmation.</p>}
  {plan&&<Modal title="Review Changes" onClose={()=>setPlan(null)} panelClassName="external-agent-panel" footer={<>
   <button className="btn-secondary" type="button" disabled={working} onClick={()=>setPlan(null)}>Back to selection</button>
   <button className="btn-primary" type="button" disabled={working||!plan.effective_diff} onClick={confirm}>{registration?'Confirm and connect':'Confirm changes'}</button>
  </>}><AccessChangeReview plan={plan} catalog={capabilities}/>{plan.outlet_scope&&<section className="mt-3 space-y-1" aria-label="Outlet scope changes"><h3 className="text-sm font-semibold">Restaurant outlet scope</h3>{['before','after'].map(key=><p key={key} className="text-sm">{key==='before'?'Current':'After confirmation'}: {plan.outlet_scope[key].type==='all'?'All current and future outlets':plan.outlet_scope[key].type==='none'?'None':plan.outlet_scope[key].outlet_ids.map(id=>scopeData?.outlets.find(o=>o.value===id)?.label||'Unavailable outlet').join(', ')}</p>)}</section>}</Modal>}
 </div>;
}
