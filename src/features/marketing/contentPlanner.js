export const PLANNER_TIMEZONE='Asia/Kuala_Lumpur';
export const taskStatuses=[['planned','Planned'],['in_progress','In Progress'],['in_review','In Review'],['revision_needed','Revision Needed'],['completed','Completed']].map(([value,label])=>({value,label}));
export const taskPriorities=[{value:'normal',label:'Normal'},{value:'high',label:'High'}];
export const taskTypes=[['post','Post'],['reel','Reel'],['story','Story'],['photography','Photography'],['design','Design']].map(([value,label])=>({value,label}));
export const todayKey=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:PLANNER_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const currentMonth=(date=new Date())=>todayKey(date).slice(0,7)+'-01';
export function shiftDate(day,offset){return new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
export function weekOf(day){const date=new Date(day+'T12:00:00Z');return shiftDate(day,-((date.getUTCDay()+6)%7));}
export function monthWeeks(month){const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);const weeks=[];for(let day=weekOf(month);day<=end;day=shiftDate(day,7))weeks.push(day);return weeks;}
export function shiftMonth(month,offset){const d=new Date(month+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10);}
export function allowedMoves(task,canEdit){if(!canEdit)return [];if(task.status==='planned')return ['in_progress'];if(['in_progress','revision_needed'].includes(task.status))return ['planned',...(!task.blocked?['in_review']:[]),...(task.status==='revision_needed'?['in_progress']:[])];return [];}
export function plannerSummary(tasks,today=todayKey()){
 const active=tasks.filter(t=>t.status!=='completed');const week=weekOf(today),end=shiftDate(week,7);
 return {planned:tasks.length,completed:tasks.length-active.length,due:active.filter(t=>t.due_date>=week&&t.due_date<end).length,overdue:active.filter(t=>t.due_date<today).length,blocked:active.filter(t=>t.blocked).length,carriedForward:active.filter(t=>t.carried_forward).length};
}
export function sortedTasks(tasks,sort='workload',today=todayKey()){
 return [...tasks].sort((a,b)=>sort==='manual'?a.manual_order-b.manual_order||a.created_at.localeCompare(b.created_at):sort==='due'?a.due_date.localeCompare(b.due_date):sort==='title'?a.title.localeCompare(b.title):
 Number(a.status==='completed')-Number(b.status==='completed')||Number(b.due_date<today)-Number(a.due_date<today)||Number(b.blocked)-Number(a.blocked)||a.due_date.localeCompare(b.due_date)||Number(b.priority==='high')-Number(a.priority==='high')||a.title.localeCompare(b.title));
}
export function filterTasks(tasks,{search='',assignee='',status='',brand='',blocked=false}={}){return tasks.filter(t=>!t.deleted_at&&(!t.carried_forward||taskStatuses.some(s=>s.value===t.status&&s.value!=='completed'))&&(!brand||t.brand_id===brand)&&(!status||t.status===status)&&(!assignee||(assignee==='unassigned'?!t.assignee_id:t.assignee_id===assignee))&&(!blocked||t.blocked)&&(!search||`${t.title} ${t.brand_name} ${t.brief}`.toLowerCase().includes(search.toLowerCase())));}
export function taskPayload(task){return Object.fromEntries(['title','checklist','content_type','assignee_id','due_date','planned_publish_date','priority','brief','reference_links','asset_ids','blocked','blocker_reason','blocker_owner','planned_week'].map(key=>[key,task[key]??(key==='reference_links'||key==='asset_ids'||key==='checklist'?[]:key==='blocked'?false:'')]));}
export function plannerPreferences(user){try{const p=JSON.parse(localStorage.getItem(`marketing.planner.${user}`)||'{}');return {...p,view:['board','list','month'].includes(p.view)?p.view:'board',groupBy:['status','brand','assignee'].includes(p.groupBy)?p.groupBy:'',listColumns:Array.isArray(p.listColumns)?p.listColumns.filter(v=>['checklist','publish','type'].includes(v)):[],month:/^\d{4}-\d{2}-01$/.test(p.month)?p.month:currentMonth()};}catch{return {view:'board',groupBy:'',listColumns:[],month:currentMonth()};}}

export function taskStatusAction(task,status,canEdit,canApprove){
 if(task.status===status)return canEdit?'order':null;
 if(['planned','in_progress','in_review'].includes(task.status)&&!task.blocked&&canApprove){
  if(status==='completed')return 'approve';
  if(status==='revision_needed')return 'request_revision';
 }
 if(task.status==='completed'&&status==='in_progress'&&canEdit)return 'save';
 return allowedMoves(task,canEdit).includes(status)?'transition':null;
}
export function listStatusMoves(task,canEdit,canApprove){
 return taskStatuses.map(s=>s.value).filter(status=>status!==task.status&&taskStatusAction(task,status,canEdit,canApprove));
}
export function canReorderList(prefs,canEdit,count){
 return canEdit&&prefs.sort==='manual'&&!prefs.groupBy&&!prefs.brand&&!prefs.search&&!prefs.status&&!prefs.assignee&&!prefs.blocked&&count<=500;
}
// Pagination happens before grouping, so group counts describe this page only.
export function plannerListGroups(rows,groupBy){
 if(!groupBy)return [{key:'all',label:'',tasks:rows}];
 const groups=new Map();
 for(const task of rows){const key=groupBy==='status'?task.status:groupBy==='brand'?task.brand_id:task.assignee_id||'unassigned';
  const label=groupBy==='status'?taskStatuses.find(s=>s.value===key)?.label||key:groupBy==='brand'?task.brand_name:task.assignee_name||'Unassigned';
  if(!groups.has(key))groups.set(key,{key,label,tasks:[]});groups.get(key).tasks.push(task);
 }
 return [...groups.values()].sort((a,b)=>groupBy==='status'?taskStatuses.findIndex(s=>s.value===a.key)-taskStatuses.findIndex(s=>s.value===b.key):a.label.localeCompare(b.label));
}

export function taskDueState(task,today=todayKey()){if(task.status==='completed'||!task.due_date)return 'normal';return task.due_date<today?'overdue':task.due_date===today?'today':task.due_date===shiftDate(today,1)?'tomorrow':'normal';}

// Completion recency comes from the canonical approval event, never mutable updated/due dates.
export function completedAt(task){
 return task.completed_at || [...(task.history||[])].filter(h=>h.action==='approve'&&h.date).sort((a,b)=>b.revision-a.revision)[0]?.date || null;
}
export function recentCompleted(task,today=todayKey()){
 const stamp=completedAt(task);if(!stamp||!Number.isFinite(Date.parse(stamp)))return false;
 const day=todayKey(new Date(stamp));return day>=shiftDate(today,-6)&&day<=today;
}
export function revisionInstructions(task){
 if(task.status!=='revision_needed')return null;
 const latest=[...(task.history||[])].filter(h=>Number.isInteger(h.revision)&&h.revision<=task.revision&&['request_revision','transition','approve'].includes(h.action)).sort((a,b)=>b.revision-a.revision)[0];
 return latest?.action==='request_revision'&&typeof latest.feedback==='string'?latest.feedback.trim():'';
}
export function monthDays(month){
 const start=weekOf(month),end=shiftMonth(month,1);let last=shiftDate(end,-1);
 last=shiftDate(last,6-((new Date(last+'T12:00:00Z').getUTCDay()+6)%7));
 const days=[];for(let day=start;day<=last;day=shiftDate(day,1))days.push(day);return days;
}
