import {useEffect,useState} from 'react';
import Modal from '../feedback/Modal.jsx';
import AccessScopeSummary from './AccessScopeSummary.jsx';
import AccessChangeReview from './AccessChangeReview.jsx';
import {externalAgentService} from '../../services/externalAgentService.js';
import './moduleAccessSelector.css';
import {actionLabels,capabilityDomain} from './capabilityActions.js';

export {actionLabels} from './capabilityActions.js';
function businessRows(rows) {
 const modules=new Map();
 for(const row of rows){const key=row.module_id||row.name;if(!modules.has(key))modules.set(key,[]);modules.get(key).push(row);}
 const order=['view','create','update','submit','complete','verify','approve','cancel'];
 return [...modules].map(([key,entries])=>[key,entries.toSorted((a,b)=>order.indexOf(a.capability)-order.indexOf(b.capability))]);
}
export default function BusinessCapabilitySelector({capabilities=[],identityId=null,canManage=false,busy=false,onConfirmed,onConfirmRegistration,registration=false}) {
 const baseline=c=>!registration && !!c.granted;
 const [selected,setSelected]=useState(()=>capabilities.filter(baseline).map(c=>c.name));
 const [plan,setPlan]=useState(null),[working,setWorking]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setSelected(capabilities.filter(c=>!registration && c.granted).map(c=>c.name));setPlan(null);},[capabilities,registration]);
 const groups=new Map();
 for(const c of capabilities){const group=`${c.workspace||'Factory'} / ${capabilityDomain(c,capabilities)}`;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(c);}
 const chosen=c=>selected.includes(c.name);
 const changed=capabilities.some(c=>baseline(c)!==chosen(c));
 async function review(){setWorking(true);setError('');try{setPlan(await externalAgentService.review(identityId,selected));}catch(e){setError(e.message);}finally{setWorking(false);}}
 async function confirm(){
  setWorking(true);setError('');
  try{if(registration)await onConfirmRegistration(selected,plan.review_hash);else {await externalAgentService.confirmAccess(identityId,selected,plan.review_hash);await onConfirmed?.();}setPlan(null);}
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
      {c.read_only===false&&<p className="text-xs text-text-secondary">{baseline(c)?c.view_granted===false?'Granted · View required':'Granted':'Restricted'}{baseline(c)!==chosen(c)?' · Staged':''}<br/>{c.requires_human_approval?'Human confirmation':'Autonomous'}</p>}
     </div>)}</div>
    </div>{entries.map(c=><AccessScopeSummary key={c.name} capability={c} catalog={capabilities}/>)}
   </div></li>;})}</ul>
  </details>)}
  <button type="button" className="btn-primary" disabled={busy||working||!canManage||(!registration&&!changed)||(registration&&!selected.length)} onClick={review}>{working?'Preparing review…':'Review Changes'}</button>
  {changed&&!plan&&<p className="text-xs text-text-secondary">Selections are staged. Effective access is unchanged until confirmation.</p>}
  {plan&&<Modal title="Review Changes" onClose={()=>setPlan(null)} panelClassName="external-agent-panel" footer={<>
   <button className="btn-secondary" type="button" disabled={working} onClick={()=>setPlan(null)}>Back to selection</button>
   <button className="btn-primary" type="button" disabled={working||!plan.effective_diff} onClick={confirm}>{registration?'Confirm and connect':'Confirm changes'}</button>
  </>}><AccessChangeReview plan={plan} catalog={capabilities}/></Modal>}
 </div>;
}
