import {useEffect,useId,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,CalendarDays,Flag,GripVertical,Image as ImageIcon,ListChecks,LoaderCircle,MoreHorizontal,SlidersHorizontal,UserRound} from 'lucide-react';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import FloatingLayer from '../../components/ui/FloatingLayer.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DatePickerField from '../../components/forms/DatePickerField.jsx';
import MarketingMediaPreview from './MarketingMediaPreview.jsx';
import {listStatusMoves,plannerListGroups,taskDueState,taskStatuses,taskTypes} from './contentPlanner.js';

const statusName=value=>taskStatuses.find(s=>s.value===value)?.label||value;
const typeName=value=>taskTypes.find(s=>s.value===value)?.label||value;
const dueLabel=value=>value?new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(value+'T00:00:00+08:00')):'Not set';
const optionalColumns=[{key:'checklist',label:'Checklist'},{key:'publish',label:'Planned Publish Date'},{key:'type',label:'Content Type'}];
function Status({task}){return <Badge semantic tone={task.status==='completed'?'success':task.status==='revision_needed'?'danger':task.status==='in_review'?'warning':task.status==='in_progress'?'info':'neutral'}>{statusName(task.status)}</Badge>}
function Checklist({task}){const steps=task.checklist||[];return steps.length?<span className="planner-list-checklist" title="Checklist progress" aria-label={`${steps.filter(s=>s.done).length} of ${steps.length} checklist steps complete`}><ListChecks size={13}/>{steps.filter(s=>s.done).length}/{steps.length}</span>:<span className="planner-list-muted">—</span>}

function InlineValue({task,field,label,value,children,options,onChange,state,disabled,date=false}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),anchor=useRef(null),control=useRef(null),id=useId();
 const saving=state?.field===field&&state.saving,error=state?.field===field&&state.error;
 useEffect(()=>{if(open&&!date){const frame=requestAnimationFrame(()=>control.current?.click());return()=>cancelAnimationFrame(frame)}},[open,date]);
 async function save(next){if(next===value||await onChange(next)){setOpen(false);requestAnimationFrame(()=>anchor.current?.focus())}}
 function close(next){if(!saving){setOpen(next);if(!next)anchor.current?.focus()}}
 return <div className="planner-list-property" aria-busy={saving||undefined}>
  {disabled?<span className="planner-list-value">{children}</span>:<button ref={anchor} type="button" className={`planner-list-value planner-list-edit${saving?' is-saving':''}`} aria-label={`${label} for ${task.title}`} aria-haspopup={date?undefined:'listbox'} aria-controls={open?id+'-editor':undefined} aria-expanded={open} aria-describedby={error?id:undefined} disabled={!!state?.saving} onClick={()=>{setDraft(value);setOpen(true)}}>{children}{saving?<LoaderCircle size={13} className="planner-list-spinner" aria-label="Saving"/>:null}</button>}
  {error?<small id={id} role="alert" className="planner-list-error">{error}</small>:null}
  <FloatingLayer open={open} onOpenChange={close} anchorRef={anchor} width={268} align="start" focusOnOpen className="planner-list-editor">
   {/* Nested controls use body portals and the shared floating ancestry, outside this positioning transform. */}
   <div role="group" id={id+'-editor'} aria-label={`Edit ${label.toLowerCase()} for ${task.title}`}>
    {date?<><DatePickerField label={label} value={draft} required disabled={saving} onChange={setDraft}/><div className="planner-list-editor-actions"><button className="btn-ghost" disabled={saving} onClick={()=>close(false)}>Cancel</button><button className="btn-primary" disabled={saving||!draft} onClick={()=>save(draft)}>Save date</button></div></>:<SelectField buttonRef={control} ariaLabel={`${label} options for ${task.title}`} value={value} disabled={saving} searchable={field==='assignee_id'?'auto':false} options={options} onChange={save}/>}
    {field!=='status'&&['completed','in_review'].includes(task.status)?<p className="planner-list-editor-note">Editing reviewed work returns it to In Progress and requires review again.</p>:null}
   </div>
  </FloatingLayer>
 </div>
}

function TaskActions({task,can,busy,previous,next,reorderable,onOpen,onMedia,onStatus,onReorder}){
 const [open,setOpen]=useState(false);
 const moves=listStatusMoves(task,can('edit'),can('approve'));
 function action(run){setOpen(false);run()}
 return <ActionMenu open={open} onOpenChange={setOpen} ariaLabel={`Actions for ${task.title}`} trigger={({toggle,open})=><button type="button" className="icon-btn planner-list-actions" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle}><MoreHorizontal size={17}/></button>}>
  <div role="menu" aria-label={`Actions for ${task.title}`}>
   <button role="menuitem" className="planner-list-menu-item" onClick={()=>action(()=>onOpen(task))}>Open task</button>
   {can('edit')?<button role="menuitem" className="planner-list-menu-item" onClick={()=>action(()=>onMedia(task))}>Edit media</button>:null}
   {moves.map(status=><button role="menuitem" className="planner-list-menu-item" key={status} onClick={()=>action(()=>onStatus(task,status))}>{status==='completed'?'Approve production…':status==='revision_needed'?'Request revision…':task.status==='completed'?'Reopen task…':status==='planned'?'Return to Planned':status==='in_review'?'Submit for Review':'Start work'}</button>)}
   {reorderable?<><button role="menuitem" className="planner-list-menu-item" disabled={!previous} onClick={()=>action(()=>onReorder(task.id,previous.id))}><ArrowUp size={14}/>Move up</button><button role="menuitem" className="planner-list-menu-item" disabled={!next} onClick={()=>action(()=>onReorder(task.id,next.id,true))}><ArrowDown size={14}/>Move down</button></>:null}
   {can('delete')?<button role="menuitem" className="planner-list-menu-item text-danger" onClick={()=>action(()=>onOpen(task,true))}>Remove task…</button>:null}
  </div>
 </ActionMenu>
}

export default function PlannerTaskList({rows,prefs,members=[],orderLimitExceeded=false,onPreferences,can,busy,fieldState={},reorderable,onChange,onStatus,onOpen,onMedia,onReorder}){
 const [columnsOpen,setColumnsOpen]=useState(false),[dropTarget,setDropTarget]=useState(''),drag=useRef(null),dragCleanup=useRef(()=>{});
 const extras=prefs.listColumns||[],groups=plannerListGroups(rows,prefs.groupBy);
 useEffect(()=>{dragCleanup.current();drag.current=null;setDropTarget('')},[prefs.groupBy,prefs.sort,rows,reorderable]);
 useEffect(()=>()=>dragCleanup.current(),[]);
 function startOrder(event,task){
  if(!reorderable||busy||fieldState[task.id]?.saving||event.button!==0)return;
  dragCleanup.current();event.preventDefault();event.currentTarget.focus();
  const x=event.clientX,y=event.clientY;let target=null,moved=false;drag.current=task.id;
  function pointerMove(e){
   if(Math.hypot(e.clientX-x,e.clientY-y)<6&&!moved)return;moved=true;
   const row=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-planner-task]'),id=row?.dataset.plannerTask;
   target=id!==task.id&&rows.some(task=>task.id===id)?{id,after:e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2}:null;
   setDropTarget(old=>old?.id===target?.id&&old?.after===target?.after?old:target||'');
  }
  function stop(){window.removeEventListener('pointermove',pointerMove);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',stop);drag.current=null;setDropTarget('');dragCleanup.current=()=>{}}
  function finish(){const valid=moved&&target&&drag.current===task.id;stop();if(valid)onReorder(task.id,target.id,target.after)}
  window.addEventListener('pointermove',pointerMove);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',stop);dragCleanup.current=stop;
 }
 const property=(task,field,label,content,options,date=false)=> <InlineValue task={task} field={field} label={label} value={task[field]||''} options={options} date={date} state={fieldState[task.id]} disabled={busy||!can('edit')} onChange={value=>onChange(task,field,value)}>{content}</InlineValue>;
 const columns=[
  {key:'task',header:'Task',className:'planner-list-task-cell',render:task=>{
   const assets=(task.asset_ids||[]).map(id=>(task.assets||[]).find(a=>a.id===id)).filter(Boolean);
   return <div className="planner-list-task">
    {reorderable?<button className="planner-list-drag" aria-label={`Reorder ${task.title}. Use Arrow Up or Arrow Down to move within this page.`} disabled={busy||fieldState[task.id]?.saving} onPointerDown={e=>startOrder(e,task)} onKeyDown={e=>{const i=rows.findIndex(t=>t.id===task.id),dest=rows[i+(e.key==='ArrowUp'?-1:1)];if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(dest)onReorder(task.id,dest.id,e.key==='ArrowDown')}}}><GripVertical size={15}/></button>:null}
    <span className="planner-list-thumbnail">{assets.length?<MarketingMediaPreview compact asset={assets[0]} assets={assets}/>:<button type="button" className="planner-list-no-media" aria-label={`Open ${task.title}`} onClick={()=>onOpen(task)}><ImageIcon size={17}/></button>}</span>
    <div className="planner-list-task-copy"><button className="planner-list-title" onClick={()=>onOpen(task)}><strong>{task.title}</strong></button><div className="planner-list-task-meta">{!extras.includes('type')?<span>{typeName(task.content_type)}</span>:null}{!extras.includes('checklist')&&(task.checklist||[]).length?<Checklist task={task}/>:null}{task.blocked?<span className="planner-list-blocked" title={task.blocker_reason}>Blocked</span>:null}</div></div>
   </div>
  }},
  {key:'brand',header:'Brand',width:154,className:'planner-list-brand-cell',render:task=><span className="planner-list-brand" title={task.brand_name}>{task.brand_name}</span>},
  {key:'status',header:'Status',width:142,className:'planner-list-status-cell',render:task=>{const moves=listStatusMoves(task,can('edit'),can('approve'));return <InlineValue task={task} field="status" label="Status" value={task.status} options={[task.status,...moves].map(value=>({value,label:statusName(value)}))} disabled={busy||!moves.length} state={fieldState[task.id]} onChange={value=>onStatus(task,value)}><Status task={task}/></InlineValue>}},
  {key:'priority',header:'Priority',width:96,className:'planner-list-priority-cell',render:task=>property(task,'priority','Priority',<span className={`planner-list-priority${task.priority==='high'?' is-high':''}`}><Flag size={13}/>{task.priority==='high'?'High':'Normal'}</span>,[{value:'normal',label:'Normal'},{value:'high',label:'High'}])},
  {key:'due',header:'Production Due',width:142,className:'planner-list-due-cell',render:task=>property(task,'due_date','Production Due Date',<span className={`planner-list-date planner-due-${taskDueState(task)}`}><CalendarDays size={13}/><time dateTime={task.due_date}>{dueLabel(task.due_date)}</time></span>,null,true)},
  {key:'assignee',header:'Assignee',width:140,className:'planner-list-assignee-cell',render:task=>property(task,'assignee_id','Assignee',<span className={`planner-list-person${task.assignee_name?'':' is-unassigned'}`} title={task.assignee_name||'Unassigned'}><UserRound size={13}/><span>{task.assignee_name||'Unassigned'}</span></span>,[{value:'',label:'Unassigned'},...members.filter(m=>m.brand_ids.includes(task.brand_id)).map(m=>({value:m.id,label:m.name}))])},
  ...extras.map(key=>({key,header:key==='publish'?'Planned Publish':optionalColumns.find(c=>c.key===key).label,width:key==='publish'?160:100,className:'planner-list-extra-cell',render:task=><><span className="planner-list-extra-label">{optionalColumns.find(c=>c.key===key).label}</span>{key==='checklist'?<Checklist task={task}/>:key==='publish'?<time dateTime={task.planned_publish_date||undefined}>{dueLabel(task.planned_publish_date)}</time>:typeName(task.content_type)}</>})),
  {key:'actions',header:'Actions',width:76,className:'planner-list-actions-cell',render:(task)=>{const i=rows.findIndex(t=>t.id===task.id);return <TaskActions task={task} can={can} busy={busy||fieldState[task.id]?.saving} previous={rows[i-1]} next={rows[i+1]} reorderable={reorderable} onOpen={onOpen} onMedia={onMedia} onStatus={onStatus} onReorder={onReorder}/>}},
 ].map(column=>({...column,headerClassName:column.className}));
 return <section className="planner-task-list" aria-label="Creative task list">
  <div className="planner-list-toolbar"><SelectField label="Group By" value={prefs.groupBy||''} onChange={groupBy=>onPreferences({groupBy})} options={[{value:'',label:'None'},{value:'status',label:'Status'},{value:'brand',label:'Brand'},{value:'assignee',label:'Assignee'}]}/><span className="planner-list-hint">{prefs.groupBy?'Groups show tasks on this page.':reorderable?'Drag the handle to reorder tasks on this page.':orderLimitExceeded?'Manual ordering supports plans with up to 500 tasks.':'Reorder in All Brands with Manual Order, no grouping or filters.'}</span>
   <ActionMenu open={columnsOpen} onOpenChange={setColumnsOpen} ariaLabel="Planner columns" width={236} trigger={({toggle,open})=><button className="btn-secondary" aria-expanded={open} aria-haspopup="menu" onClick={toggle}><SlidersHorizontal size={14}/>Columns</button>}><fieldset className="planner-list-columns"><legend>Additional columns</legend>{optionalColumns.map(column=><label key={column.key}><input type="checkbox" checked={extras.includes(column.key)} onChange={e=>onPreferences({listColumns:e.target.checked?[...extras,column.key]:extras.filter(key=>key!==column.key)})}/>{column.label}</label>)}</fieldset></ActionMenu>
  </div>
  {groups.map(group=><section key={group.key} className="planner-list-group" aria-label={group.label?`${group.label} tasks on this page`:undefined}>{group.label?<header className="planner-list-group-heading"><h3>{group.label}</h3><span>{group.tasks.length} {group.tasks.length===1?'task':'tasks'} on this page</span></header>:null}<DataTable columns={columns} rows={group.tasks} getRowKey={task=>task.id} density="compact" columnSpacing="compact" minWidth={920+extras.reduce((sum,key)=>sum+(key==='publish'?160:100),0)} tableClassName={`planner-list-table${extras.length?' has-extras':''}`} onRowClick={task=>onOpen(task)} getRowProps={task=>({tabIndex:0,'aria-label':`Open ${task.title}`,className:dropTarget?.id===task.id?(dropTarget.after?'planner-list-drop-after':'planner-list-drop-target'):'',onKeyDown:e=>{if(e.target===e.currentTarget&&['Enter',' '].includes(e.key)){e.preventDefault();onOpen(task)}},'data-planner-task':task.id})}/></section>)}
 </section>
}
