import {ArrowUpDown,CheckCircle2,ClipboardCheck,Flag,Link,MessageSquare,Plus,RefreshCw,Trash2,UserRound} from 'lucide-react';

const actions={
 generated:{title:'Recurring task created',icon:Plus,type:'created'},
 create:{title:'Task created',icon:Plus,type:'created'},
 save:{title:'Task updated',icon:RefreshCw,type:'updated'},
 transition:{title:'Status changed',icon:RefreshCw,type:'updated'},
 request_revision:{title:'Revision requested',icon:MessageSquare,type:'alert'},
 approve:{title:'Production completed',icon:CheckCircle2,type:'created'},
 ordered:{title:'Board order updated',icon:ArrowUpDown,type:'audit'},
 block:{title:'Blocker updated',icon:Flag,type:'alert'},
 delete:{title:'Task removed',icon:Trash2,type:'audit'},
 handoff:{title:'Linked to Content Management',icon:Link,type:'updated'},
};
const statuses={planned:'Planned',in_progress:'In Progress',in_review:'In Review',revision_needed:'Revision Needed',completed:'Completed'};
const assignee=state=>state.assignee_name||(state.assignee_id?'Team member unavailable':'Unassigned');

// One presentation per immutable revision. Never infer a field change across a missing revision.
export function plannerActivity(history=[]){
 const rows=[...history].sort((a,b)=>b.revision-a.revision);
 return rows.map((row,index)=>{
  const before=rows[index+1],state=row.state,previous=before?.revision===row.revision-1?before.state:null;
  const event={...row,id:String(row.revision),...(actions[row.action]||{title:'Task activity',icon:RefreshCw,type:'audit'}),metadata:[],feedback:row.action==='request_revision'||row.action==='approve'?row.feedback:null};
  if(row.action==='transition'&&state?.status==='in_review'){event.title='Submitted for review';event.icon=ClipboardCheck}
  else if(row.action==='transition'&&state?.status&&previous?.status){event.title=`Moved to ${statuses[state.status]||'another status'}`;event.metadata.push(`${statuses[previous.status]||previous.status} → ${statuses[state.status]||state.status}`)}
  if(row.action==='save'&&state&&previous){
   if(Object.hasOwn(state,'assignee_id')&&Object.hasOwn(previous,'assignee_id')&&state.assignee_id!==previous.assignee_id){event.title='Assignment changed';event.icon=UserRound;event.metadata.push(`${assignee(previous)} → ${assignee(state)}`)}
   if(['normal','high'].includes(state.priority)&&['normal','high'].includes(previous.priority)&&state.priority!==previous.priority){event.title=event.metadata.length?'Assignment and priority changed':'Priority changed';if(!event.metadata.length)event.icon=Flag;event.metadata.push(`Priority: ${previous.priority==='high'?'High':'Normal'} → ${state.priority==='high'?'High':'Normal'}`)}
   if(statuses[state.status]&&statuses[previous.status]&&state.status!==previous.status)event.metadata.push(`${statuses[previous.status]||previous.status} → ${statuses[state.status]||state.status}`);
  }
  if(row.action==='request_revision'&&!row.feedback?.trim())event.feedback='No revision instructions provided';
  event.metadata=event.metadata.join(' · ');return event;
 });
}

// Only adjacent reorder records on the same local date are grouped; expanded rows stay exact.
export function activityRuns(events,timeZone='Asia/Kuala_Lumpur'){
 const runs=[];
 for(const event of events){
  const date=Number.isFinite(Date.parse(event.date))?new Date(event.date).toLocaleDateString('en-CA',{timeZone}):'unknown';
  const previous=runs.at(-1);
  if(event.action==='ordered'&&previous?.ordered&&previous.date===date)previous.events.push(event);
  else runs.push({id:event.id,date,ordered:event.action==='ordered',events:[event]});
 }
 return runs;
}
