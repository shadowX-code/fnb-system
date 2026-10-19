import {taskPayload} from './contentPlanner.js';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const revisionRejected=error=>['PT409','40001'].includes(error.cause?.code||error.code);
function changedTask(current){
 const error=new Error('Task changed elsewhere. Your edits are kept. Load the latest task, review the changes, then save again.');
 error.latestTask=current;return error;
}
export function mergeTaskDraft(draft,previous,current){
 const before=taskPayload(previous),after=taskPayload(current);
 return Object.fromEntries(Object.keys(after).map(key=>[key,equal(draft[key],before[key])?after[key]:draft[key]]));
}

// Retry only a proven revision rejection, never an uncertain write or a lifecycle change.
export async function savePlannerTask(service,{task,intent,attempt,readBrand,isCurrent=()=>true}){
 const before=taskPayload(task);
 const changes=Object.fromEntries(Object.entries(intent.payload).filter(([key,value])=>key!=='month'&&!equal(value,before[key])));
 const initial={...intent,payload:{month:intent.payload.month,...changes}};
 const send=operation=>service.command({...operation,requestId:operation.requestId||attempt.id});
 try{return await send(attempt.rebased||initial)}catch(error){
  if(!revisionRejected(error))throw error;
  const fresh=await service.read(intent.org,intent.payload.month,readBrand||'');
  if(!isCurrent())throw error;
  const current=fresh.tasks.find(t=>t.id===task.id&&t.brand_id===task.brand_id&&t.organization_id===task.organization_id);
  const after=current&&taskPayload(current);
  const conflicts=Object.keys(changes).filter(key=>!equal(after?.[key],before[key])&&!equal(after?.[key],changes[key]));
  if(attempt.rebased||!current||current.status!==task.status||current.linked_content_id!==task.linked_content_id||current.planning_month!==task.planning_month||conflicts.length){
   throw changedTask(current);
  }
  if(Object.keys(changes).every(key=>equal(after[key],changes[key])))return current;
  attempt.rebased={...initial,revision:current.revision,requestId:crypto.randomUUID()};
  try{return await send(attempt.rebased)}catch(retryError){
   if(!revisionRejected(retryError))throw retryError;
   const latest=await service.read(intent.org,intent.payload.month,readBrand||'');
   if(!isCurrent())throw retryError;
   throw changedTask(latest.tasks.find(t=>t.id===task.id&&t.brand_id===task.brand_id&&t.organization_id===task.organization_id));
  }
 }
}
