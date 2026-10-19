import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Plus,ChevronLeft,ChevronRight,CalendarDays,Clock,CheckCircle2,Eye,PlayCircle,ClipboardList,MessageSquare,Pencil,MoreHorizontal,AlignLeft,ListChecks,History,ExternalLink,Image as ImageIcon,Repeat2,X,Link as LinkIcon} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import TextareaField from '../../components/forms/TextareaField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import AdminKanbanBoard from '../../components/ui/AdminKanbanBoard.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import DatePickerField from '../../components/forms/DatePickerField.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import MetricCard from '../../components/ui/MetricCard.jsx';
import ContentTypeBadge from './ContentTypeBadge.jsx';
import PlanningInsights from './PlanningInsights.jsx';
import PlannerTaskList, {PlannerListColumns} from './PlannerTaskList.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import MarketingMediaPicker from './MarketingMediaPicker.jsx';
import MarketingMediaPreview from './MarketingMediaPreview.jsx';
import {marketingService} from './marketingService.js';
import {plannerService} from './plannerService.js';
import {savePlannerTask,mergeTaskDraft} from './plannerTaskSave.js';
import {recentCompleted,taskDueState,taskStatuses,taskTypes,taskPriorities,currentMonth,todayKey,shiftMonth,shiftDate,monthWeeks,allowedMoves,plannerSummary,sortedTasks,filterTasks,taskPayload,plannerPreferences,listStatusMoves,taskStatusAction,canReorderList} from './contentPlanner.js';
import './contentPlanner.css';
const statusName=value=>taskStatuses.find(s=>s.value===value)?.label||value;
const typeName=value=>taskTypes.find(s=>s.value===value)?.label||value;
const shortDate=value=>value?new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'Not set';
const monthName=value=>new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
const all={value:'',label:'All'};
const emptyData={tasks:[],members:[],targets:[],templates:[],drafts:[]};
function StateBadge({task}){return <Badge tone={task.status==='completed'?'success':task.status==='revision_needed'?'danger':task.status==='in_review'?'warning':'neutral'}>{statusName(task.status)}</Badge>;}
function DateField(props){return <DatePickerField {...props}/>;}
export default function ContentPlannerPage({surface="planner"}){
 const insights=surface==="insights";
 const auth=useAuth(),user=auth.user?.id;
 const [insightsView,setInsightsView]=useState(()=>plannerPreferences(user).insightsView||'production');
 const [prefs,setPrefs]=useState(()=>plannerPreferences(user)),[context,setContext]=useState(null),[org,setOrg]=useState(''),[data,setData]=useState(emptyData),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[dialog,setDialog]=useState(null),[dropFeedback,setDropFeedback]=useState(''),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
 const retained=useRef(false);
 const [fieldState,setFieldState]=useState({}),fieldPending=useRef(new Map()),fieldRequests=useRef(new Map());
 const inlineBusy=Object.values(fieldState).some(value=>value.saving);
 const serial=useRef(0),scope=useRef(''),request=useRef(null),openMonthRequests=useRef(new Map());
 const can=action=>auth.hasPermission('marketing_planner.'+action),brandId=prefs.brand||'',month=prefs.month,view=prefs.view==='month'?'board':prefs.view,brands=context?.brands.filter(b=>b.organization_id===org)||[];
 scope.current=JSON.stringify([user,org,month,brandId]);
 useEffect(()=>{fieldPending.current.clear();fieldRequests.current.clear();setFieldState({});},[user,org,month,brandId]);
 const editPrefs=patch=>{setPrefs(p=>({...p,...patch}));setPage(1);};
 useEffect(()=>{let live=true;setContext(null);setData(emptyData);setLoading(true);setError('');setBusy(false);setNotice('');setDialog(null);marketingService.context().then(c=>{if(live){setContext(c);const p=plannerPreferences(user),q=new URLSearchParams(window.location.search),queryOrg=q.get('marketing_org'),queryBrand=q.get('marketing_brand');if(queryBrand||c.organizations.some(o=>o.id===queryOrg)){const next=resolveBrandContext(c,queryBrand,queryOrg);p.org=next.org;p.brand=next.brand;if(/^\d{4}-\d{2}-01$/.test(q.get('month')||''))p.month=q.get('month');if(q.has('status')||q.has('task_id'))p.view='list';p.search='';p.assignee='';p.blocked=false;p.status=taskStatuses.some(v=>v.value===q.get('status'))?q.get('status'):'';}const next=resolveBrandContext(c,p.brand,p.org);p.brand=next.brand;setPrefs(p);setInsightsView(p.insightsView||'production');setOrg(next.org);}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false;serial.current++;}},[user]);
 useEffect(()=>{if(context&&brandId&&!brands.some(b=>b.id===brandId))editPrefs({brand:''});},[context,org,brandId]);
 useEffect(()=>{if(!context||!org)return;try{localStorage.setItem(`marketing.planner.${user}`,JSON.stringify({...prefs,org}));}catch{}},[prefs,org,user,context]);
 useEffect(()=>{
  const sequence=++serial.current;if(!retained.current)setData(emptyData);setError('');setDialog(null);request.current=null;if(!org||!context)return;
  if(brandId&&!brands.some(b=>b.id===brandId))return;
  if(!retained.current)setLoading(true);retained.current=false;const key=scope.current;if(!openMonthRequests.current.has(key))openMonthRequests.current.set(key,crypto.randomUUID());
  plannerService.command({requestId:openMonthRequests.current.get(key),org,brand:brandId,action:'open_month',payload:{month}}).then(()=>plannerService.read(org,month,brandId)).then(value=>{if(serial.current===sequence)setData(value)}).catch(e=>{if(serial.current===sequence)setError(e.message)}).finally(()=>{if(serial.current===sequence)setLoading(false)});
  return()=>{serial.current++};
 },[org,month,brandId,refresh,context,user]);
 async function mutate(action,task,payload={},message='Planner updated.',options={}){
  const startScope=scope.current,intent={org,brand:task?.brand_id||options.brand||brandId,action,id:task?.id||options.id||null,revision:task?.revision??options.revision??0,payload:{month,...payload}},fingerprint=JSON.stringify(intent);
  if(request.current?.fingerprint!==fingerprint)request.current={id:crypto.randomUUID(),fingerprint};setBusy(true);setError('');
  let accepted=null;
  function acceptTask(result){if(result?.id!==task?.id)return;setData(d=>({...d,tasks:d.tasks.map(t=>t.id===result.id&&t.revision<=result.revision?{...t,...result}:t)}));setDialog(d=>['detail','media'].includes(d?.type)&&d.task.id===result.id&&d.task.revision<=result.revision?{...d,task:{...d.task,...result},latestTask:null}:d);}
  try{
   accepted=action==='save'&&task?await savePlannerTask(plannerService,{task,intent,attempt:request.current,readBrand:brandId,isCurrent:()=>scope.current===startScope}):await plannerService.command({...intent,requestId:request.current.id});
   if(scope.current!==startScope)return false;
   acceptTask(accepted);request.current=null;
   setNotice(action==='generate'?`${accepted.generated} tasks generated. Existing and skipped occurrences were preserved.`:message);
   if(options.keepOpen&&action!=='delete'){
    try{const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope){setData(d=>({...fresh,tasks:fresh.tasks.map(t=>{const local=d.tasks.find(v=>v.id===t.id);return local?.revision>t.revision?local:t})}));const latest=fresh.tasks.find(t=>t.id===task.id);if(latest)acceptTask(latest);}}
    catch{if(scope.current===startScope)setNotice('Saved. Activity could not refresh; your saved revision is retained.');}
   }else{setDialog(null);retained.current=true;setRefresh(v=>v+1);}
   return accepted;
  }catch(e){if(scope.current===startScope){setError(e.message);if(e.latestTask)setDialog(d=>d?.task?.id===task?.id?{...d,latestTask:e.latestTask}:d);}return false;}
  finally{if(scope.current===startScope)setBusy(false)}
 }
 function loadLatestTask(){setDialog(d=>d?.latestTask?{...d,task:d.latestTask,latestTask:null}:d);request.current=null;setError('');setNotice('Latest task loaded. Your edits are kept; review before saving.');}
 function open(value){if(busy||fieldPending.current.has(value.task?.id)||(!value.task&&inlineBusy))return;setError('');request.current=null;setDialog(value);}
 const openedDashboardTask=useRef('');
 useEffect(()=>{const id=new URLSearchParams(window.location.search).get('task_id');if(loading||!id||openedDashboardTask.current===id)return;const task=data.tasks.find(t=>t.id===id);if(task){openedDashboardTask.current=id;setDialog({type:'detail',task});const url=new URL(window.location.href);url.searchParams.delete('task_id');window.history.replaceState(window.history.state,'',url);}},[data,loading]);
 const tasks=useMemo(()=>filterTasks(data.tasks,prefs),[data.tasks,prefs]),sorted=useMemo(()=>sortedTasks(tasks,prefs.sort),[tasks,prefs.sort]),summary=plannerSummary(tasks),today=todayKey(),weeks=monthWeeks(month);
 const membersFor=brand=>data.members.filter(m=>m.brand_ids.includes(brand)).map(m=>({value:m.id,label:m.name}));
 const reorderable=canReorderList(prefs,can('edit'),data.tasks.length);
 useEffect(()=>setPage(value=>Math.min(value,Math.max(1,Math.ceil(sorted.length/pageSize)))),[sorted.length,pageSize]);
 async function inlineCommand(task,field,action,payload){
  if(busy||fieldPending.current.has(task.id))return false;
  const startScope=scope.current,intent={org,brand:task.brand_id,id:task.id,revision:task.revision,action,payload:{month,...payload}},fingerprint=JSON.stringify(intent),key=task.id+':'+field;
  if(fieldRequests.current.get(key)?.fingerprint!==fingerprint)fieldRequests.current.set(key,{requestId:crypto.randomUUID(),fingerprint});
  const attempt=fieldRequests.current.get(key);fieldPending.current.set(task.id,attempt);
  const patch=action==='transition'?{status:payload.status}:action==='approve'?{status:'completed'}:action==='request_revision'?{status:'revision_needed'}:{...payload,...(['in_review','completed'].includes(task.status)?{status:'in_progress',approved_revision:null}:{})};
  if(field==='assignee_id')patch.assignee_name=data.members.find(m=>m.id===payload.assignee_id)?.name||null;
  setFieldState(state=>({...state,[task.id]:{field,saving:true,error:''}}));
  setData(current=>({...current,tasks:current.tasks.map(t=>t.id===task.id?{...t,...patch}:t)}));
  let accepted=null;
  function reconcile(fresh){setData(current=>({...fresh,tasks:fresh.tasks.map(t=>{const displayed=current.tasks.find(v=>v.id===t.id);return (t.id!==task.id&&fieldPending.current.has(t.id))||(displayed?.revision>t.revision)?displayed||t:t})}));}
  try{
   accepted=await plannerService.command({...intent,requestId:attempt.requestId});
   if(scope.current!==startScope)return false;
   if(accepted?.id===task.id)setData(current=>({...current,tasks:current.tasks.map(t=>t.id===task.id?{...t,...accepted}:t)}));
   const fresh=await plannerService.read(org,month,brandId);
   if(scope.current!==startScope)return false;
   reconcile(fresh);fieldRequests.current.delete(key);
   setFieldState(state=>({...state,[task.id]:{field,saving:false,error:''}}));setNotice('Task updated.');return true;
  }catch(e){
   if(scope.current!==startScope)return false;
   if(!accepted)setData(current=>({...current,tasks:current.tasks.map(t=>t.id===task.id?task:t)}));
   setFieldState(state=>({...state,[task.id]:{field,saving:false,error:accepted?'Saved, but task details could not refresh. Reopen the task to check.':e.message}}));
   if(!accepted)try{const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope)reconcile(fresh)}catch{}
   return !!accepted;
  }finally{if(fieldPending.current.get(task.id)===attempt)fieldPending.current.delete(task.id)}
 }
 function inlineStatus(task,status){
  if(busy||fieldPending.current.has(task.id)||!listStatusMoves(task,can('edit'),can('approve')).includes(status))return false;
  const operation=taskStatusAction(task,status,can('edit'),can('approve'));
  if(['approve','request_revision','save'].includes(operation)){
   setDropFeedback('');setError('');setFieldState(state=>({...state,[task.id]:{field:'status',saving:false,error:''}}));setDialog({type:'list_status',task,column:status,operation});return true;
  }
  return inlineCommand(task,'status','transition',{status});
 }
 async function confirmListStatus(){
  const task=data.tasks.find(t=>t.id===dialog.task.id);
  if(!task||task.revision!==dialog.task.revision){setError('Task changed. Reopen it before reviewing.');return;}
  const operation=dialog.operation,payload=operation==='request_revision'?{feedback:dropFeedback}:operation==='save'?{title:task.title}:{};
  if(await inlineCommand(task,'status',operation,payload))setDialog(null);
 }
 async function reorder(sourceId,destinationId,after=false){
  if(!reorderable||busy||inlineBusy||sourceId===destinationId)return;
  const source=sorted.find(t=>t.id===sourceId),dest=sorted.find(t=>t.id===destinationId);if(!source||!dest)return;
  const previous=data,next=sorted.filter(t=>t.id!==source.id);next.splice(next.findIndex(t=>t.id===dest.id)+(after?1:0),0,source);
  const startScope=scope.current;setBusy(true);setError('');
  setData(current=>({...current,tasks:next.map((task,index)=>({...task,manual_order:index+1}))}));
  try{await plannerService.order(crypto.randomUUID(),org,month,next);const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope){setData(fresh);setNotice('Manual order saved.')}}
  catch(e){if(scope.current===startScope){setData(previous);setError(e.message);try{const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope)setData(fresh)}catch{}}}
  finally{if(scope.current===startScope)setBusy(false)}
 }
 function dropOperation(task,column){return taskStatusAction(task,column,can('edit'),can('approve'));}
 async function boardDrop(task,column,beforeId,confirmed=false){
  if(busy)return;
  const operation=dropOperation(task,column);
  if(!operation)return;
  if(!confirmed&&['approve','request_revision','save'].includes(operation)){
   setDropFeedback('');open({type:'drop',task,column,beforeId,operation});return;
  }
  const same=task.status===column;
  if(!same&&!operation)return;

  const previous=data,startScope=scope.current;
  const changed={...task,...(same?{}:{status:column})};
  const order=sorted.filter(t=>t.id!==task.id);let insertion=beforeId?order.findIndex(t=>t.id===beforeId):-1;
  if(insertion<0){const last=order.findLastIndex(t=>t.status===column);insertion=last<0?order.length:last+1;}
  order.splice(insertion,0,changed);
  setData(d=>({...d,tasks:d.tasks.map(t=>t.id===task.id?changed:t).map(t=>({...t,manual_order:order.some(o=>o.id===t.id)?order.findIndex(o=>o.id===t.id)+1:t.manual_order}))}));setBusy(true);setError('');
  try{
   if(!same)await plannerService.command({requestId:crypto.randomUUID(),org,brand:task.brand_id,id:task.id,revision:task.revision,action:operation,payload:{month,...(operation==='save'?{title:task.title}:operation==='request_revision'?{feedback:dropFeedback}:{status:column})}});
   let authoritative=await plannerService.read(org,month,brandId);
   {
    const freshOrder=order.map(t=>authoritative.tasks.find(a=>a.id===t.id)).filter(Boolean);
    if(can('edit'))await plannerService.order(crypto.randomUUID(),org,month,freshOrder);
    authoritative=await plannerService.read(org,month,brandId);
   }
   if(scope.current===startScope){setData(authoritative);editPrefs({sort:'manual'});setDialog(null);setNotice(same?'Manual order saved.':`Task moved to ${statusName(column)}.`);}
  }catch(e){if(scope.current===startScope){setData(previous);setError(e.message);try{const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope)setData(fresh)}catch{}}}
  finally{if(scope.current===startScope)setBusy(false)}
 }
 async function reschedule(task,date){
  if(busy||!can('edit')||['in_review','completed'].includes(task.status)||!date||date===task.due_date)return;
  const previous=data,startScope=scope.current;
  setData(d=>({...d,tasks:d.tasks.map(t=>t.id===task.id?{...t,due_date:date}:t)}));setBusy(true);setError('');
  try{
   await plannerService.command({requestId:crypto.randomUUID(),org,brand:task.brand_id,id:task.id,revision:task.revision,action:'save',payload:{month,due_date:date}});
   const fresh=await plannerService.read(org,month,brandId);
   if(scope.current===startScope){setData(fresh);setNotice('Production due date updated.');}
  }catch(e){if(scope.current===startScope){setData(previous);setError(e.message);try{const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope)setData(fresh)}catch{}}}
  finally{if(scope.current===startScope)setBusy(false)}
 }
 async function reschedulePublish(task,date){
  if(busy||!can('edit')||task.linked_content_id||['in_review','completed'].includes(task.status)||!date||date===task.planned_publish_date)return;
  const previous=data,startScope=scope.current;
  setData(d=>({...d,tasks:d.tasks.map(t=>t.id===task.id?{...t,planned_publish_date:date}:t)}));setBusy(true);setError('');
  try{await plannerService.command({requestId:crypto.randomUUID(),org,brand:task.brand_id,id:task.id,revision:task.revision,action:'save',payload:{month,planned_publish_date:date}});
   const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope){setData(fresh);setNotice('Planned publish date updated.');}
  }catch(e){if(scope.current===startScope){setData(previous);setError(e.message);try{const fresh=await plannerService.read(org,month,brandId);if(scope.current===startScope)setData(fresh)}catch{}}}finally{if(scope.current===startScope)setBusy(false)}
 }
 const quickAdd=()=>open({type:'quick',brand:brandId||brands[0]?.id||''});
 const actions=insights?null:<><button className="btn-secondary" disabled={busy||inlineBusy||loading} onClick={()=>open({type:'templates'})}><Repeat2 size={15}/>Recurring tasks</button>{can('create')?<button className="btn-primary" disabled={busy||inlineBusy||loading||!brands.length} onClick={quickAdd}><Plus size={15}/>New Task</button>:null}</>;
 const controls=<div className="planner-controls"><div className="admin-scope-controls" aria-label="Marketing scope"><SelectField searchable="auto" label="Brand" value={brandId} disabled={busy} onChange={v=>selectBrandContext(context,v,org,setOrg,brand=>editPrefs({brand}))} options={[{value:'',label:'All'},...(context?.brands||[]).map(b=>({value:b.id,label:b.name}))]}/></div><div className="planner-period"><button className="icon-btn" aria-label="Previous month" disabled={busy} onClick={()=>editPrefs({month:shiftMonth(month,-1)})}><ChevronLeft size={17}/></button><MonthPickerField label="Planning month" value={month.slice(0,7)} disabled={busy} onChange={value=>editPrefs({month:value+'-01'})}/><button className="icon-btn" aria-label="Next month" disabled={busy} onClick={()=>editPrefs({month:shiftMonth(month,1)})}><ChevronRight size={17}/></button><button className="btn-secondary" disabled={busy} onClick={()=>editPrefs({month:currentMonth()})}>This month</button></div></div>;
 function taskCard(task){const due=taskDueState(task,today),checklist=task.checklist||[],assets=(task.asset_ids||[]).map(id=>(task.assets||[]).find(a=>a.id===id)).filter(Boolean);return <article className={`planner-task${task.blocked?' is-blocked':''}`}><div className="planner-card-brand"><span>{task.brand_name}</span></div><div className="planner-card-media">{assets.length?<MarketingMediaPreview compact cover asset={assets[0]} assets={assets}/>:<button className="planner-media-empty" disabled={!can('edit')||busy} aria-label={`Add media to ${task.title}`} onClick={()=>open({type:'media',task})}><ImageIcon size={15}/><span>Add Media</span></button>}{assets.length&&can('edit')?<button className="planner-media-action btn-secondary" aria-label={`Replace media for ${task.title}`} disabled={busy} onClick={()=>open({type:'media',task})}><Pencil size={12}/>Media</button>:null}</div><button className="planner-task-open" onClick={()=>open({type:'detail',task})}><h3>{task.title}</h3></button><div className="planner-card-labels"><ContentTypeBadge value={task.content_type}/>{task.priority==='high'?<Badge tone="danger">High</Badge>:null}{task.blocked?<span title={task.blocker_reason||'Blocked'} aria-label={task.blocker_reason?`Blocked: ${task.blocker_reason}`:'Blocked'}><Badge tone="warning">Blocked</Badge></span>:null}</div><div className="planner-task-meta"><span className={`planner-due planner-due-${due}`} title="Production Due Date"><CalendarDays size={13}/>{due==='today'?'Today':due==='tomorrow'?'Tomorrow':shortDate(task.due_date)}{due==='overdue'?' · Overdue':''}</span>{checklist.length?<span className="planner-checklist-count" aria-label={`${checklist.filter(v=>v.done).length} of ${checklist.length} production steps complete`}><CheckCircle2 size={12}/>{checklist.filter(v=>v.done).length}/{checklist.length}</span>:null}<span className="planner-assignee" title={task.assignee_name||'Unassigned'} aria-label={task.assignee_name||'Unassigned'}>{task.assignee_name?task.assignee_name.split(' ').map(v=>v[0]).slice(0,2).join(''):'—'}</span></div><button className="planner-card-action icon-btn" aria-label={`View ${task.title}`} onClick={()=>open({type:'detail',task})}><ExternalLink size={13}/></button></article>;}
 const columnIcons={planned:ClipboardList,in_progress:PlayCircle,in_review:Eye,revision_needed:MessageSquare,completed:CheckCircle2};
 const rejection=(task,column)=>column==='completed'?'Production completion needs reviewer approval. Open the task to review.':task?.status==='in_review'?'In Review: a reviewer must approve production or request changes in the task.':task?.status==='completed'?'Completed work must be edited and reviewed again.':task?.blocked&&column==='in_review'?'Resolve this task’s blocker before submitting for review.':'This lifecycle move is unavailable. Open the task for available actions.';
 return <WorkspacePage section="Marketing · Content Studio" title={insights?"Planning Insights":"Content Planner"} density="compact" className="planner-workspace" controls={controls} actions={actions}>
  {error&&!dialog&&data.tasks.length?<p role="alert" className="text-danger text-sm">{error}</p>:null}
  {notice?<p role="status" className="sr-only">{notice}</p>:null}
  <AsyncDataSurface loading={loading} error={!dialog&&!data.tasks.length?error:''} hasData={!!context&&!loading} onRetry={()=>setRefresh(v=>v+1)}>
  {context&&!org?<p>Ask an administrator for Brand access and team permissions.</p>:null}
  {org?<>{!insights?<div className="planner-kpis" role="region" aria-label="Creative production summary">{[['Total Tasks',summary.planned,'neutral',ClipboardList],['In Progress',tasks.filter(t=>t.status==='in_progress').length,'info',PlayCircle],['In Review',tasks.filter(t=>t.status==='in_review').length,'warning',Eye],['Overdue',summary.overdue,'danger',Clock],['Completed',summary.completed,'success',CheckCircle2]].map(([label,value,tone,icon])=><MetricCard key={label} label={label} value={value} tone={tone} icon={icon} presentation="summary" size="compact" className={`planner-kpi planner-kpi-${tone}`}/>)}</div>:null}
  {(!insights||insightsView!=='targets')?<AdminFilterToolbar ariaLabel={insights?'Planning Insights filters':'Planner filters'} compact denseFields
   search={<AdminSearchField value={prefs.search||''} onChange={v=>editPrefs({search:v})} placeholder="Search creative tasks"/>}
   filters={<><SelectField searchable="auto" label="Assignee" value={prefs.assignee||''} onChange={v=>editPrefs({assignee:v})} options={[all,{value:'unassigned',label:'Unassigned'},...data.members.map(m=>({value:m.id,label:m.name}))]}/><SelectField label="Status" value={prefs.status||''} onChange={v=>editPrefs({status:v})} options={[all,...taskStatuses]}/><SelectField label="Handling" value={prefs.blocked?'blocked':''} onChange={v=>editPrefs({blocked:!!v})} options={[all,{value:'blocked',label:'Blocked'}]}/><SelectField label="Sort" value={prefs.sort||'workload'} onChange={v=>editPrefs({sort:v})} options={[{value:'workload',label:'Workload priority'},{value:'due',label:'Due date'},{value:'title',label:'Title A–Z'},{value:'manual',label:'Manual Order'}]}/>{!insights&&view==='list'?<SelectField label="Group By" value={prefs.groupBy||''} onChange={groupBy=>editPrefs({groupBy})} options={[{value:'',label:'None'},{value:'status',label:'Status'},{value:'brand',label:'Brand'},{value:'assignee',label:'Assignee'}]}/>:null}</>}
   secondaryActions={!insights?<>{view==='list'?<PlannerListColumns value={prefs.listColumns||[]} onChange={listColumns=>setPrefs(p=>({...p,listColumns}))}/>:null}<AdminSegmentedControl label="Planner view" value={view} onChange={v=>editPrefs({view:v})} options={[{value:'board',label:'Board'},{value:'list',label:'List'}]}/></>:null}
   onClear={()=>editPrefs({search:'',assignee:'',status:'',blocked:false})}
   activeFilters={[
    prefs.search&&{key:'search',label:'Search',value:prefs.search,onRemove:()=>editPrefs({search:''})},
    prefs.assignee&&{key:'assignee',label:'Assignee',value:prefs.assignee==='unassigned'?'Unassigned':data.members.find(m=>m.id===prefs.assignee)?.name||'Selected member',onRemove:()=>editPrefs({assignee:''})},
    prefs.status&&{key:'status',label:'Status',value:statusName(prefs.status),onRemove:()=>editPrefs({status:''})},
    prefs.blocked&&{key:'handling',label:'Handling',value:'Blocked',onRemove:()=>editPrefs({blocked:false})},
   ].filter(Boolean)}/>:null}
  {!insights&&!tasks.length&&view==='list'?<div className="planner-empty"><CalendarDays size={28}/><h2>No creative tasks in this view</h2><p>{data.tasks.length?'Clear filters to see other tasks.':'Add your first task or generate this month’s recurring work.'}</p>{can('create')?<button className="btn-secondary" disabled={busy} onClick={quickAdd}>Add task</button>:null}</div>:null}
  {!insights&&view==='board'?<AdminKanbanBoard onOpenItem={task=>open({type:'detail',task})} label="Creative workflow" className="planner-board" columnClassName={column=>`planner-column planner-column-${column.value}`} disabled={busy||inlineBusy} columns={taskStatuses.map(status=>({...status,items:sorted.filter(t=>t.status===status.value&&(status.value!=='completed'||prefs.search||recentCompleted(t,today)))}))} canDrop={(task,column)=>!!dropOperation(task,column)} rejectionReason={rejection} onDrop={boardDrop} renderHeader={status=>{const Icon=columnIcons[status.value];return <><h2><Icon size={16}/>{status.label}</h2><Badge>{status.items.length}{status.value==='completed'&&!prefs.search?' recent':''}</Badge></>}} renderItem={taskCard} renderFooter={status=><>{status.value==='completed'&&!prefs.search?(()=>{const hidden=sorted.filter(t=>t.status==='completed'&&!recentCompleted(t,today)).length;return <div className="planner-completed-history"><small>Last 7 days{hidden?` · ${hidden} older or undated hidden`:''}</small><button className="btn-ghost" onClick={()=>editPrefs({view:'list',status:'completed'})}>View All Completed</button></div>})():null}{!status.items.length?<div className="planner-column-empty"><span>{status.value==='completed'?<CheckCircle2 size={26}/>:status.value==='revision_needed'?<MessageSquare size={26}/>:<ClipboardList size={26}/>}</span><strong>{status.value==='completed'?(prefs.search?'No completed tasks':'No recent completed tasks'):'No tasks yet'}</strong><p>{status.value==='planned'?'Plan your next creative task.':status.value==='completed'?'Reviewed production will appear here.':`Tasks ${status.value==='in_review'?'ready for review':status.value==='revision_needed'?'needing changes':'in production'} will appear here.`}</p>{status.value==='planned'&&can('create')?<button className="planner-add" disabled={busy} onClick={quickAdd}><Plus size={14}/>Add Task</button>:null}</div>:null}{status.items.length>0&&status.value==='planned'&&can('create')?<button className="planner-add" disabled={busy} onClick={quickAdd}><Plus size={14}/>Add task</button>:null}</>}/>:null}
  {!insights&&view==='list'?<><PlannerTaskList key={scope.current} rows={sorted.slice((page-1)*pageSize,page*pageSize)} prefs={prefs} members={data.members} orderLimitExceeded={data.tasks.length>500} can={can} busy={busy} fieldState={fieldState} reorderable={reorderable&&!inlineBusy} onChange={(task,field,value)=>can('edit')&&inlineCommand(task,field,'save',{[field]:value})} onStatus={inlineStatus} onOpen={(task,remove=false)=>open({type:'detail',task,remove})} onMedia={task=>open({type:'media',task})} onReorder={reorder}/><AdminPagination page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} onPageSizeChange={size=>{setPageSize(size);setPage(1)}}/></>:null}
  {insights?<PlanningInsights standalone view={insightsView} setView={value=>{setInsightsView(value);editPrefs({insightsView:value})}} organizationId={org} brandId={brandId} brands={brands} canContent={auth.hasPermission('marketing_calendar.view')||auth.hasPermission('marketing_content.view')} onMonth={value=>editPrefs({month:value})} onPublishReschedule={reschedulePublish} key={`${org}:${month}:${brandId}`} tasks={sorted} targets={data.targets} month={month} today={today} busy={busy} canEdit={can('edit')} canConfigure={can('configure')} onOpen={task=>open({type:'detail',task})} onReschedule={reschedule} onTargets={brand=>open({type:'targets',brand})}/>:null}

  </>:null}
  </AsyncDataSurface>
  {dialog?.type==='media'?<Modal title={`Creative media · ${dialog.task.title}`} size="lg" onClose={()=>{if(!busy)setDialog(null)}} footer={<button className="btn-secondary" disabled={busy} onClick={()=>setDialog(null)}>Close</button>}><MarketingMediaPicker initialOpen thumbnailPreviews brand={brands.find(b=>b.id===dialog.task.brand_id)} disabled={busy} attachments assets={dialog.task.assets} values={dialog.task.asset_ids} onChange={asset_ids=>mutate('save',dialog.task,{asset_ids},'Creative media updated.',{keepOpen:true})}/>{error?<p role="alert">{error}</p>:null}{dialog.latestTask?<button className="btn-secondary" disabled={busy} onClick={loadLatestTask}>Load latest task · keep selection</button>:null}</Modal>:null}
  {['drop','list_status'].includes(dialog?.type)?<Modal title={dialog.operation==='approve'?'Approve production':dialog.operation==='request_revision'?'Request Revision':'Reopen completed task'} onClose={()=>{if(!busy&&!inlineBusy)setDialog(null)}} footer={<><button className="btn-secondary" disabled={busy||inlineBusy} onClick={()=>setDialog(null)}>Cancel</button><button className="btn-primary" disabled={busy||inlineBusy} onClick={()=>dialog.type==='list_status'?confirmListStatus():boardDrop(dialog.task,dialog.column,dialog.beforeId,true)}>{dialog.operation==='approve'?'Approve':dialog.operation==='request_revision'?'Request Revision':'Reopen'}</button></>}><p className="mb-4 font-medium">{dialog.task.title}</p>{dialog.operation==='request_revision'?<TextareaField label="Review feedback (optional)" rows={3} value={dropFeedback} onChange={setDropFeedback} maxLength={2000}/>:<p>{dialog.operation==='approve'?'Approve the current creative revision? Publishing approval remains separate.':'Reopening invalidates production approval. This task must be reviewed again.'}</p>}{error||fieldState[dialog.task.id]?.error?<p role="alert" className="text-danger">{error||fieldState[dialog.task.id]?.error}</p>:null}</Modal>:null}
  {dialog?.type==='quick'?<QuickTask membersFor={membersFor} brands={brands} initialBrand={dialog.brand} month={month} busy={busy} error={error} onClose={()=>{if(!busy)setDialog(null)}} onSave={(brand,payload)=>mutate('create',null,payload,'Task added.',{brand})}/>:null}
  {dialog?.type==='detail'?<TaskDetail key={dialog.task.id} initialRemove={dialog.remove} task={dialog.task} brand={brands.find(b=>b.id===dialog.task.brand_id)} canContent={action=>auth.hasPermission('marketing_content.'+action)} weeks={weeks} members={membersFor(dialog.task.brand_id)} drafts={data.drafts} can={can} onReopen={()=>{setDropFeedback('');open({type:'drop',task:dialog.task,column:'in_progress',operation:'save'})}} busy={busy||inlineBusy} error={error} latestTask={dialog.latestTask} onLoadLatest={loadLatestTask} onClose={()=>{if(!busy)setDialog(null)}} command={(action,payload,message)=>mutate(action,dialog.task,payload,message,{keepOpen:true})}/>:null}
  {dialog?.type==='targets'?<Targets data={data.targets} initialBrand={dialog.brand} busy={busy} error={error} onClose={()=>{if(!busy)setDialog(null)}} onSave={(target,mode,posts,reels)=>mutate('target',null,{mode,posts,reels},'Targets saved. Other months and brand defaults preserved.',{brand:target.brand_id,revision:mode==='default'?target.default_revision:target.revision})}/>:null}
  {dialog?.type==='templates'?<Templates templates={data.templates} brands={brands} initialBrand={brandId} month={month} membersFor={membersFor} busy={busy} error={error} can={can} onClose={()=>{if(!busy)setDialog(null)}} onSave={(template,payload,brand)=>mutate('template',null,payload,'Recurring template saved. Existing occurrences preserved.',{brand,id:template?.id,revision:template?.revision||0})} onGenerate={()=>mutate('generate',null,{},'',{})} onSkip={(template,date)=>mutate('skip_occurrence',null,{date},'Occurrence skipped without creating a task.',{brand:template.brand_id,id:template.id})}/>:null}
 </WorkspacePage>;
}

function QuickTask({brands,initialBrand,month,membersFor,busy,error,onSave,onClose}){
 const [brand,setBrand]=useState(initialBrand),[title,setTitle]=useState(''),[type,setType]=useState('post'),[due,setDue]=useState(month===currentMonth()?todayKey():month),[assignee,setAssignee]=useState(''),[priority,setPriority]=useState(taskPriorities[0].value),[description,setDescription]=useState('');
 const members=membersFor(brand),eligibleAssignee=members.some(m=>m.value===assignee)?assignee:'';
 return <Modal title="New creative task" size="md" onClose={onClose} footer={<><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!brand||!title.trim()||!due} onClick={()=>onSave(brand,{title,content_type:type,due_date:due,assignee_id:eligibleAssignee,priority,brief:description})}>{busy?'Saving…':'Add task'}</button></>}><div className="planner-form">
 <SelectField searchable="auto" label="Brand" value={brand} disabled={busy} onChange={value=>{setBrand(value);setAssignee('')}} options={brands.map(b=>({value:b.id,label:b.name+(b.is_active===false?' · Inactive':''),disabled:b.is_active===false}))}/>
 <AdminFormField label="Title" required><input className="control" value={title} maxLength={200} disabled={busy} onChange={e=>setTitle(e.target.value)}/></AdminFormField>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><SelectField label="Content Type" value={type} disabled={busy} onChange={setType} options={taskTypes}/><DateField label="Production Due Date" value={due} disabled={busy} onChange={setDue} required/></div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><SelectField searchable="auto" label="Assignee" value={eligibleAssignee} disabled={busy} onChange={setAssignee} options={[{value:'',label:'Unassigned'},...members]}/><SelectField label="Priority" value={priority} disabled={busy} onChange={setPriority} options={taskPriorities}/></div>
 <TextareaField label="Description" value={description} onChange={setDescription} rows={3} maxLength={8000} disabled={busy}/>
 {error?<p role="alert" className="text-danger text-sm">{error}</p>:null}</div></Modal>;
}
function TaskDetail({task,initialRemove=false,brand,weeks,members,drafts,can,canContent,busy,error,latestTask,onLoadLatest,onClose,onReopen,command}){
 const [form,setForm]=useState(()=>taskPayload(task)),[feedback,setFeedback]=useState(''),[existing,setExisting]=useState(''),[confirmDelete,setConfirmDelete]=useState(initialRemove),[link,setLink]=useState(''),[linkError,setLinkError]=useState(''),[editingDescription,setEditingDescription]=useState(false),[newStep,setNewStep]=useState(''),[addingItem,setAddingItem]=useState(false),[addingLink,setAddingLink]=useState(false),[reviewing,setReviewing]=useState(false),[actionsOpen,setActionsOpen]=useState(false);
 const previousTask=useRef(task);
 useEffect(()=>{const previous=previousTask.current;setForm(draft=>mergeTaskDraft(draft,previous,task));previousTask.current=task},[task.revision]);
 useEffect(()=>{setFeedback('');setReviewing(false)},[task.status]);
 const update=patch=>setForm(f=>({...f,...patch})),dirty=JSON.stringify(taskPayload(task))!==JSON.stringify(form),readOnly=!can('edit')||busy;
 async function commit(patch={}){const next={...form,...patch};if(!next.title.trim()||!next.due_date)return false;update(patch);if(JSON.stringify(taskPayload(task))!==JSON.stringify(next)){const blocking=['blocked','blocker_reason','blocker_owner'];const creativeChanged=Object.keys(next).some(key=>!blocking.includes(key)&&JSON.stringify(next[key])!==JSON.stringify(taskPayload(task)[key]));const result=await (creativeChanged?command('save',next,'Task saved.'):command('block',Object.fromEntries(blocking.map(key=>[key,next[key]])),'Blocker details saved.'));return result;}}
 const eligibleDrafts=drafts.filter(d=>d.brand_id===task.brand_id),moves=allowedMoves(task,can('edit')),primary=moves.includes('in_review')?'in_review':moves.includes('in_progress')?'in_progress':null;
 const moveLabel=status=>status==='in_review'?'Submit for Review':status==='planned'?'Return to Planned':'Start work';
 async function saveDescription(){if(!dirty){setEditingDescription(false);return}if(await commit())setEditingDescription(false)}
 function cancelDescription(){update({brief:task.brief||''});setEditingDescription(false)}
 async function addItem(){if(!newStep.trim()||readOnly)return;const previous=form.checklist;const saved=await commit({checklist:[...previous,{text:newStep.trim(),done:false}]});if(saved){setNewStep('');setAddingItem(false)}else update({checklist:previous})}
 async function addLink(){try{const url=new URL(link.trim());if(url.protocol!=='https:')throw new Error();if(form.reference_links.includes(url.href)){setLink('');setLinkError('');setAddingLink(false);return}const saved=await commit({reference_links:[...new Set([...form.reference_links,url.href])]});if(saved){setLink('');setLinkError('');setAddingLink(false)}}catch{setLinkError('Enter a valid HTTPS link.')}}
 const taskHeader=<header className="planner-detail-header"><button className="icon-btn planner-detail-close" type="button" aria-label="Close drawer" disabled={busy} onClick={onClose}><X size={17}/></button><section className="planner-detail-intro"><AdminFormField label="Task title" required><input className="control" value={form.title} disabled={readOnly} maxLength={200} onChange={e=>update({title:e.target.value})} onBlur={()=>commit()}/></AdminFormField><div className="planner-detail-identity"><Badge>{task.brand_name}</Badge><ContentTypeBadge value={task.content_type}/><StateBadge task={task}/>{task.blocked?<Badge tone="warning">Blocked</Badge>:null}</div><SelectField label="Content Type" value={form.content_type} disabled={readOnly} onChange={v=>commit({content_type:v,asset_ids:[]})} options={taskTypes}/><div className="planner-header-actions">
 {['planned','in_progress'].includes(task.status)&&can('approve')?<button className="btn-secondary" disabled={busy||dirty||task.blocked} onClick={()=>command('approve',{},'Production completed. Publishing approval remains separate.')}>Complete production</button>:null}
 {primary?<button className="btn-primary" disabled={busy||dirty} onClick={()=>command('transition',{status:primary},`Task moved to ${statusName(primary)}.`)}>{moveLabel(primary)}</button>:task.status==='in_review'&&can('approve')?<button className="btn-primary" disabled={busy||dirty||task.blocked} onClick={()=>command('approve',{feedback},'Creative production approved. Publishing approval remains separate.')}>Approve</button>:null}
 {task.status==='completed'&&can('edit')?<button className="btn-secondary" disabled={busy||dirty} onClick={onReopen}>Reopen</button>:null}
 {can('edit')?<button className="btn-secondary" disabled={busy||dirty} onClick={()=>command('block',{blocked:!task.blocked},task.blocked?'Task unblocked.':'Task marked blocked.')}>{task.blocked?'Unblock':'Mark Blocked'}</button>:null}
 {(moves.some(v=>v!==primary)||can('delete'))?<ActionMenu open={actionsOpen} onOpenChange={setActionsOpen} ariaLabel="Task actions" trigger={({toggle,open})=><button type="button" className="icon-btn" aria-label="Task actions" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle}><MoreHorizontal size={18}/></button>}><div role="menu" aria-label="Task actions">
 {moves.filter(v=>v!==primary).map(status=><button key={status} role="menuitem" className="planner-list-menu-item" disabled={busy||dirty} onClick={()=>{setActionsOpen(false);command('transition',{status},`Task moved to ${statusName(status)}.`)}}>{moveLabel(status)}</button>)}
 {can('delete')?<button role="menuitem" className="planner-list-menu-item text-danger" disabled={busy} onClick={()=>{setActionsOpen(false);setConfirmDelete(true)}}>Remove Task</button>:null}
 </div></ActionMenu>:null}</div></section>
 </header>;
 return <Drawer header={taskHeader} width="lg" title="Creative task" onClose={onClose} closeOnEscape={!busy} closeOnOverlay={!busy} bodyClassName="planner-detail-body" footer={<div className="planner-detail-footer"><span className="text-xs text-text-secondary">{busy?'Saving…':dirty?'Unsaved changes':'Saved'}</span><button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>{can('edit')&&dirty?<button className="btn-primary" disabled={busy||!form.title.trim()||!form.due_date} onClick={()=>commit()}>Save changes</button>:null}</div>}>
 <div className="planner-detail">
 {error?<p role="alert" className="text-danger text-sm">{error}</p>:null}
 {latestTask?<aside className="planner-review"><p>Latest attached media: {(latestTask.assets||[]).map(a=>a.filename).join(', ')||'None'}. Your edits have not been saved.</p><button className="btn-secondary" disabled={busy} onClick={onLoadLatest}>Load latest task · keep my edits</button></aside>:null}
 <div className="planner-properties" aria-label="Task properties"><SelectField searchable="auto" label="Assignee" value={form.assignee_id||''} disabled={readOnly} onChange={v=>commit({assignee_id:v})} options={[{value:'',label:'Unassigned'},...members]}/><SelectField label="Priority" value={form.priority} disabled={readOnly} onChange={v=>commit({priority:v})} options={taskPriorities}/><DateField label="Production Due Date" value={form.due_date} disabled={readOnly} onChange={v=>commit({due_date:v})}/><DateField label="Planned Publish Date" value={form.planned_publish_date} disabled={readOnly} onChange={v=>commit({planned_publish_date:v})}/><SelectField label="Planned Week" value={form.planned_week} disabled={readOnly} onChange={v=>commit({planned_week:v})} options={weeks.map((day,i)=>({value:day,label:`Week ${i+1} · ${shortDate(day)}`}))}/></div>
 {form.blocked?<aside className="planner-review"><strong>Blocked</strong><TextareaField label="Blocker reason (optional)" value={form.blocker_reason} disabled={readOnly} rows={2} maxLength={2000} onChange={value=>update({blocker_reason:value})} onBlur={()=>commit()}/><SelectField searchable="auto" label="Responsible person (optional)" value={form.blocker_owner||''} disabled={readOnly} onChange={v=>commit({blocker_owner:v})} options={[{value:'',label:'Unassigned'},...members]}/></aside>:null}
 <section className="planner-creative-assets"><h3><ImageIcon size={16}/>Creative Assets</h3>{can('edit')&&brand?<MarketingMediaPicker thumbnailPreviews brand={brand} disabled={busy} attachments assets={task.assets} values={form.asset_ids} onChange={asset_ids=>commit({asset_ids})}/>:<div className="media-selection">{(task.asset_ids||[]).map(id=>(task.assets||[]).find(a=>a.id===id)).filter(Boolean).map(a=><MarketingMediaPreview compact cover key={a.id} asset={a} assets={task.assets}/>)}</div>}{!form.asset_ids.length?<p className="planner-assets-empty">Add images, videos or PDF references for this task.</p>:null}</section>
 <section className="planner-description"><h3><AlignLeft size={16}/>Description</h3>{editingDescription?<><TextareaField ariaLabel="Description" value={form.brief} disabled={readOnly} autoFocus rows={2} maxLength={8000} onChange={value=>update({brief:value})} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelDescription()}else if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();saveDescription()}}}/><div className="planner-inline-actions"><button className="btn-primary" disabled={readOnly} onClick={saveDescription}>Save</button><button className="btn-ghost" disabled={busy} onClick={cancelDescription}>Cancel</button></div></>:readOnly?<p className="planner-brief-copy">{form.brief||'No description.'}</p>:<button className="planner-description-trigger" aria-label="Edit description" onClick={()=>setEditingDescription(true)}><span>{form.brief||'Add description...'}</span><Pencil size={14}/></button>}</section>
 <section><div className="planner-section-header"><h3><ListChecks size={16}/>Checklist</h3>{form.checklist.length?<span>{form.checklist.filter(step=>step.done).length}/{form.checklist.length} complete</span>:null}</div>{form.checklist.length?<progress aria-label="Checklist completion" max={form.checklist.length} value={form.checklist.filter(step=>step.done).length}/>:null}<div className="planner-checklist">{form.checklist.map((step,index)=><div key={index}><input type="checkbox" aria-label={`Complete ${step.text}`} checked={step.done} disabled={readOnly} onChange={e=>commit({checklist:form.checklist.map((v,i)=>i===index?{...v,done:e.target.checked}:v)})}/><input className="control" aria-label={`Checklist item ${index+1}`} value={step.text} maxLength={300} disabled={readOnly} onChange={e=>update({checklist:form.checklist.map((v,i)=>i===index?{...v,text:e.target.value}:v)})} onBlur={()=>commit()}/>{!readOnly?<button className="icon-btn" aria-label={`Remove item ${index+1}`} onClick={()=>commit({checklist:form.checklist.filter((_,i)=>i!==index)})}><X size={14}/></button>:null}</div>)}</div>{!readOnly&&form.checklist.length<30?addingItem?<div className="planner-inline-editor"><input className="control" autoFocus aria-label="Checklist item" placeholder="Add an item…" value={newStep} maxLength={300} onChange={e=>setNewStep(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addItem()}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setAddingItem(false);setNewStep('')}}}/><button className="btn-secondary" disabled={!newStep.trim()} onClick={addItem}>Add Item</button><button className="icon-btn" aria-label="Cancel new item" onClick={()=>{setAddingItem(false);setNewStep('')}}><X size={14}/></button></div>:<button className="btn-ghost planner-section-add" onClick={()=>setAddingItem(true)}><Plus size={14}/>Add Item</button>:null}</section>
 <section><h3><LinkIcon size={16}/>References</h3><div className="planner-reference-list">{form.reference_links.map(url=><div key={url}><LinkIcon size={14}/><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{!readOnly?<button className="icon-btn" aria-label={`Remove reference ${url}`} onClick={()=>commit({reference_links:form.reference_links.filter(v=>v!==url)})}><X size={14}/></button>:null}</div>)}</div>{!readOnly?addingLink?<div className="planner-inline-editor"><AdminFormField error={linkError}><input className="control" aria-label="Reference link" autoFocus type="url" placeholder="https://" value={link} onChange={e=>setLink(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addLink()}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setAddingLink(false);setLink('');setLinkError('')}}}/></AdminFormField><button className="btn-secondary" disabled={!link.trim()} onClick={addLink}>Add Link</button><button className="icon-btn" aria-label="Cancel new link" onClick={()=>{setAddingLink(false);setLink('');setLinkError('')}}><X size={14}/></button></div>:<button className="btn-ghost planner-section-add" onClick={()=>setAddingLink(true)}><Plus size={14}/>Add Link</button>:null}</section>
 {['planned','in_progress','in_review'].includes(task.status)&&can('approve')||task.review_feedback?<section className="planner-review-section"><h3><Eye size={16}/>Review</h3>{task.review_feedback?<p className="planner-feedback">{task.review_feedback}</p>:null}{task.status==='in_review'?<p className="text-sm text-text-secondary">Awaiting production review.</p>:null}{['planned','in_progress','in_review'].includes(task.status)&&can('approve')?reviewing?<div className="planner-review"><TextareaField label="Review feedback (optional)" rows={2} value={feedback} onChange={setFeedback} disabled={busy} maxLength={2000}/><button className="btn-secondary" disabled={busy||dirty||task.blocked} onClick={()=>command('request_revision',{feedback},'Revision requested.')}>Request Revision</button></div>:<button className="btn-secondary" disabled={busy||dirty||task.blocked} onClick={()=>setReviewing(true)}>Request Revision</button>:null}</section>:null}
  {(task.linked_content_id||task.status==='completed')?<section><h3><ExternalLink size={16}/>Content Management</h3>{task.linked_content_id&&canContent('view')?<><Badge>{task.linked_status||'Linked draft'}</Badge><a className="btn-secondary mt-2" href={`/marketing/calendar?marketing_org=${task.organization_id}&marketing_brand=${task.brand_id}&content_id=${task.linked_content_id}`}><ExternalLink size={14}/>Open linked content</a></>:task.status==='completed'?<div className="planner-form"><p className="text-sm text-text-secondary">The draft has its own publishing review and approval.</p>{['post','reel'].includes(task.content_type)&&can('edit')&&canContent('create')&&canContent('view')?<button className="btn-secondary" disabled={busy||dirty||task.blocked} onClick={()=>command('handoff',{},'Content draft created and linked once.')}>Create Content Draft</button>:null}{eligibleDrafts.length&&can('edit')&&canContent('view')?<><SelectField searchable="auto" label="Existing brand draft" value={existing} onChange={setExisting} options={[{value:'',label:'Select a draft'},...eligibleDrafts.map(d=>({value:d.id,label:d.title}))]}/><button className="btn-secondary" disabled={busy||dirty||task.blocked||!existing} onClick={()=>command('handoff',{content_id:existing},'Existing draft linked.')}>Link draft</button></>:null}</div>:<p className="text-sm text-text-secondary">Complete creative review to create or link a draft.</p>}</section>:null}

 {task.history?.length?<details className="planner-activity"><summary><History size={16}/>Activity <span>{task.history.length}</span></summary><ol className="planner-history">{task.history.map(h=><li key={h.revision}><strong>{h.action.replaceAll('_',' ')}</strong><span>{h.actor} · {new Date(h.date).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'})}</span>{h.feedback?<p>{h.feedback}</p>:null}</li>)}</ol></details>:null}
 <ConfirmDialog request={confirmDelete?{title:'Remove Task?',message:'This task will be soft-removed. Recurring occurrences stay skipped; linked content and activity history remain unchanged.',confirmLabel:'Remove Task',danger:true}:null} onCancel={()=>{if(!busy)setConfirmDelete(false)}} onConfirm={()=>{if(!busy){setConfirmDelete(false);command('delete',{},'Task removed. Recurring occurrence preserved.')}}}/>

 </div></Drawer>;
}
function Targets({data,initialBrand,busy,error,onSave,onClose}){
 const initial=data.find(t=>t.brand_id===initialBrand)||data[0];
 const [brand,setBrand]=useState(initial?.brand_id||''),[mode,setMode]=useState('month'),[posts,setPosts]=useState(String(initial?.posts||0)),[reels,setReels]=useState(String(initial?.reels||0));
 const target=data.find(t=>t.brand_id===brand);function load(brandValue,modeValue){const t=data.find(t=>t.brand_id===brandValue);setBrand(brandValue);setMode(modeValue);setPosts(String((modeValue==='default'?t?.default_posts:t?.posts)||0));setReels(String((modeValue==='default'?t?.default_reels:t?.reels)||0));}
 return <Modal title="Monthly content targets" onClose={onClose} footer={<><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!target||posts===''||reels===''||+posts<0||+reels<0||+posts>999||+reels>999} onClick={()=>onSave(target,mode,+posts,+reels)}>Save targets</button></>}><div className="planner-form"><SelectField searchable="auto" label="Brand" value={brand} onChange={v=>load(v,mode)} options={data.map(t=>({value:t.brand_id,label:t.brand_name}))}/><SelectField label="Apply to" value={mode} onChange={v=>load(brand,v)} options={[{value:'month',label:'This month only'},{value:'default',label:'Brand defaults for new monthly plans'}]}/><AdminFormField label="Post target"><input className="control" type="number" min={0} max={999} step={1} value={posts} onChange={e=>setPosts(e.target.value)}/></AdminFormField><AdminFormField label="Reel target"><input className="control" type="number" min={0} max={999} step={1} value={reels} onChange={e=>setReels(e.target.value)}/></AdminFormField><p className="text-sm text-text-secondary">Targets do not create tasks. Existing monthly plans retain their saved targets.</p>{error?<p role="alert" className="text-danger text-sm">{error}</p>:null}</div></Modal>;
}
function Templates({templates,brands,initialBrand,month,membersFor,busy,error,can,onSave,onGenerate,onSkip,onClose}){
 const [edit,setEdit]=useState(null),[brand,setBrand]=useState(initialBrand||brands[0]?.id||''),[form,setForm]=useState(null),[skip,setSkip]=useState(null),[skipDate,setSkipDate]=useState(month);
 const patch=value=>setForm(f=>({...f,...value}));
 function start(template=null){setEdit(template);setBrand(template?.brand_id||initialBrand||brands[0]?.id||'');setForm(template?{title:template.title,content_type:template.content_type,frequency:template.frequency,day:template.day,assignee_id:template.assignee_id||'',brief:template.brief,active:template.active}:{title:'',content_type:'post',frequency:'weekly',day:1,assignee_id:'',brief:'',active:true});}
 return <Modal title="Recurring creative tasks" size="md" onClose={onClose} footer={<button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>}><div className="planner-form">{error?<p role="alert" className="text-danger text-sm">{error}</p>:null}{can('manage')?<div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>start()}>New template</button>{can('create')?<button className="btn-primary" disabled={busy||!templates.some(t=>t.active)} onClick={onGenerate}>Generate {monthName(month)}</button>:null}</div>:null}
 {!templates.length&&!form?<p className="text-sm text-text-secondary">Create reusable weekly or monthly briefs, then generate the planning period.</p>:null}
 {!form?templates.map(t=><div className="planner-template" key={t.id}><div><strong>{t.title}</strong><p>{brands.find(b=>b.id===t.brand_id)?.name} · {typeName(t.content_type)} · {t.frequency==='weekly'?['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][t.day-1]:`Day ${t.day} each month`}</p><Badge tone={t.active?'success':'neutral'}>{t.active?'Active':'Disabled'}</Badge></div>{can('manage')?<div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>start(t)}>Edit</button>{t.active?<button className="btn-ghost" disabled={busy} onClick={()=>{setSkip(t);setSkipDate(month)}}>Skip occurrence</button>:null}</div>:null}</div>):null}
 {skip?<section className="planner-review"><strong>Skip {skip.title}</strong><DateField label="Occurrence date" value={skipDate} onChange={setSkipDate}/><button className="btn-secondary" disabled={busy||!skipDate} onClick={()=>onSkip(skip,skipDate)}>Skip this occurrence</button></section>:null}
 {form?<section className="planner-form"><SelectField searchable="auto" label="Brand" value={brand} disabled={busy||!!edit} onChange={v=>{setBrand(v);patch({assignee_id:''})}} options={brands.map(b=>({value:b.id,label:b.name+(b.is_active===false?' · Inactive':''),disabled:b.is_active===false}))}/><AdminFormField label="Template title" required><input className="control" maxLength={200} value={form.title} onChange={e=>patch({title:e.target.value})}/></AdminFormField><div className="planner-form-grid"><SelectField label="Content Type" value={form.content_type} onChange={v=>patch({content_type:v})} options={taskTypes}/><SelectField label="Frequency" value={form.frequency} onChange={v=>patch({frequency:v,day:1})} options={[{value:'weekly',label:'Weekly'},{value:'monthly',label:'Monthly'}]}/><SelectField label={form.frequency==='weekly'?'Weekday':'Day of month'} value={String(form.day)} onChange={v=>patch({day:Number(v)})} options={Array.from({length:form.frequency==='weekly'?7:28},(_,i)=>({value:String(i+1),label:form.frequency==='weekly'?['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]:String(i+1)}))}/><SelectField searchable="auto" label="Assignee" value={form.assignee_id} onChange={v=>patch({assignee_id:v})} options={[{value:'',label:'Unassigned'},...membersFor(brand)]}/></div><TextareaField label="Brief" rows={3} value={form.brief} onChange={value=>patch({brief:value})}/><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={e=>patch({active:e.target.checked})}/>Active template</label><p className="text-sm text-text-secondary">Template edits affect new occurrences only. Edit generated tasks individually.</p><div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setForm(null)}>Cancel edit</button><button className="btn-primary" disabled={busy||!brand||!form.title.trim()} onClick={()=>onSave(edit,form,brand)}>Save template</button></div></section>:null}
 </div></Modal>;
}
