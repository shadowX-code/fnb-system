import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {GripVertical} from 'lucide-react';
import './adminKanban.css';

/** Interaction only. The consumer validates transitions and owns persistence. */
export default function AdminKanbanBoard({columns,label,disabled,canDrop,onDrop,renderItem,renderHeader,renderFooter,columnClassName=()=>'',rejectionReason=()=> 'This move is unavailable.',className=''}){
 const root=useRef(null),cleanup=useRef(()=>{}),latest=useRef({}),positions=useRef(new Map()),targetRef=useRef(null),suppressClick=useRef(false),[drag,setDrag]=useState(null),[target,setTarget]=useState(null),[announcement,setAnnouncement]=useState('');
 latest.current={columns,disabled,canDrop,onDrop,rejectionReason};
 const updateTarget=value=>setTarget(old=>{const next=old?.column===value?.column&&old?.before===value?.before&&old?.rejected===value?.rejected?old:value;targetRef.current=next;return next;});
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 useEffect(()=>()=>cleanup.current(),[]);
 useEffect(()=>{if(disabled)cleanup.current()},[disabled]);
 useLayoutEffect(()=>{
  const next=new Map();root.current?.querySelectorAll('[data-kanban-item]').forEach(node=>{
   if(node.dataset.kanbanItem===drag?.item.id){next.set(node.dataset.kanbanItem,positions.current.get(node.dataset.kanbanItem));return;}
   node.getAnimations?.().forEach(animation=>animation.cancel());const box=node.getBoundingClientRect(),old=positions.current.get(node.dataset.kanbanItem);next.set(node.dataset.kanbanItem,box);
   if(old&&!reduced()&&node.animate&&(old.x!==box.x||old.y!==box.y))node.animate([{transform:`translate(${old.x-box.x}px,${old.y-box.y}px)`},{transform:'translate(0,0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
  });positions.current=next;
 },[columns,target,drag?.item.id]);
 function placement(x,y,item){
  const board=root.current?.getBoundingClientRect();if(!board||x<board.left||x>board.right||y<board.top||y>board.bottom)return null;
  const columns=[...root.current.querySelectorAll('[data-kanban-column]')];
  // Include column gaps and its whole stretched height, not only card-sized content.
  const column=columns.reduce((best,node)=>{const box=node.getBoundingClientRect(),distance=Math.abs(x-(box.left+box.right)/2);return !best||distance<best.distance?{node,distance}:best;},null)?.node;
  if(!column)return null;const value=column.dataset.kanbanColumn;
  if(!latest.current.canDrop(item,value))return {column:value,before:null,rejected:true};
  const slot=column.querySelector('.admin-kanban-insertion');if(slot){const box=slot.getBoundingClientRect();if(y>=box.top-8&&y<=box.bottom+8&&targetRef.current?.column===value)return targetRef.current;}
  const rows=[...column.querySelectorAll('[data-kanban-item]')].filter(node=>node.dataset.kanbanItem!==item.id);
  const before=rows.find(node=>{const box=node.querySelector('.admin-kanban-card').getBoundingClientRect();return y<box.top+box.height/2});
  return {column:value,before:before?.dataset.kanbanItem||null};
 }
 function start(event,item){
  if(latest.current.disabled||event.button!==0)return;
  event.currentTarget.focus?.();
  const card=event.currentTarget.closest('[data-kanban-item]'),box=card.getBoundingClientRect(),origin={x:event.clientX,y:event.clientY},pointerId=event.pointerId;
  let active=false,point={...origin},frame=0,stopped=false;
  const scroll=()=>{
   if(stopped||!active)return;
   let node=root.current;const edge=48,speed=(value,low,high)=>value<low+edge?-Math.ceil((low+edge-value)/4):value>high-edge?Math.ceil((value-high+edge)/4):0;
   while(node){const style=getComputedStyle(node),bounds=node.getBoundingClientRect();if(/auto|scroll/.test(style.overflowX)&&node.scrollWidth>node.clientWidth)node.scrollLeft+=speed(point.x,bounds.left,bounds.right);if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight)node.scrollTop+=speed(point.y,bounds.top,bounds.bottom);node=node.parentElement;}
   window.scrollBy?.(0,speed(point.y,0,window.innerHeight));
   updateTarget(placement(point.x,point.y,item));frame=requestAnimationFrame(scroll);
  };
  const move=e=>{
   if(e.pointerId!==pointerId)return;point={x:e.clientX,y:e.clientY};
   if(!active&&Math.hypot(point.x-origin.x,point.y-origin.y)<6)return;
   e.preventDefault();if(!active){active=true;document.body.classList.add('admin-kanban-dragging');setAnnouncement(`Moving ${item.title}. Escape cancels.`);frame=requestAnimationFrame(scroll);}
   setDrag({item,width:box.width,height:box.height,x:box.left+point.x-origin.x,y:box.top+point.y-origin.y});updateTarget(placement(point.x,point.y,item));
  };
  const clear=()=>{stopped=true;cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);document.body.classList.remove('admin-kanban-dragging');setDrag(null);updateTarget(null);cleanup.current=()=>{}};
  const finish=e=>{if(e.pointerId!==pointerId)return;const destination=active?placement(e.clientX,e.clientY,item):null;if(active){positions.current.set(item.id,{x:box.left+e.clientX-origin.x,y:box.top+e.clientY-origin.y});suppressClick.current=true;setTimeout(()=>{suppressClick.current=false},0)}clear();if(destination?.rejected){setAnnouncement(latest.current.rejectionReason(item,destination.column));return}if(destination&&!latest.current.disabled){setAnnouncement(`${item.title} moved to ${latest.current.columns.find(c=>c.value===destination.column)?.label}.`);latest.current.onDrop(item,destination.column,destination.before)}};
  const cancel=()=>{clear();setAnnouncement('Move cancelled.')},escape=e=>{if(e.key==='Escape'){e.preventDefault();cancel()}};
  cleanup.current();cleanup.current=clear;
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);
 }
 function keyboard(event,item,column,index){
  if(disabled)return;
  let destination=null,before=null;
  if(['ArrowLeft','ArrowRight'].includes(event.key)){const next=columns[columns.findIndex(c=>c.value===column.value)+(event.key==='ArrowLeft'?-1:1)];if(next&&canDrop(item,next.value))destination=next.value;}
  if(['ArrowUp','ArrowDown'].includes(event.key)&&canDrop(item,column.value)){const direction=event.key==='ArrowUp'?-1:1;if(index+direction>=0&&index+direction<column.items.length){destination=column.value;before=direction<0?column.items[index-1].id:column.items[index+2]?.id||null;}}
  if(!destination&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setAnnouncement(rejectionReason(item));}
  if(destination){event.preventDefault();onDrop(item,destination,before);setAnnouncement(`${item.title} moved to ${columns.find(c=>c.value===destination)?.label}.`);}
 }
 return <><section ref={root} className={`admin-kanban-board ${className}`} aria-label={label}>{columns.map(column=><section key={column.value} data-kanban-column={column.value} className={`admin-kanban-column ${columnClassName(column)}`} aria-label={column.label} data-drop-active={target?.column===column.value&&!target.rejected||undefined} data-drop-rejected={target?.column===column.value&&target.rejected||undefined}>
 <header>{renderHeader(column)}</header><div className="admin-kanban-items">{column.items.map((item,index)=><div key={item.id} data-kanban-item={item.id} className="admin-kanban-item" data-dragging={drag?.item.id===item.id||undefined}>
 {target?.column===column.value&&!target.rejected&&target.before===item.id?<div className="admin-kanban-insertion" style={{height:drag?.height||48}} aria-hidden="true"/>:null}
 <div className="admin-kanban-card" onPointerDown={e=>{if(e.target.closest('button,input,select,textarea,a')&&!e.target.closest('[data-kanban-drag-surface]'))return;if(columns.some(c=>canDrop(item,c.value)))start(e,item)}} onClickCapture={e=>{if(suppressClick.current){e.preventDefault();e.stopPropagation();}}}>{renderItem(item)}{columns.some(c=>canDrop(item,c.value))?<button type="button" className="admin-kanban-handle" aria-label={`Move ${item.title}. Use arrow keys to move, or open task for touch controls.`} title="Drag to move. Arrow keys move between columns; up/down reorder in Manual Order." disabled={disabled} onPointerDown={e=>start(e,item)} onKeyDown={e=>keyboard(e,item,column,index)}><GripVertical size={15}/></button>:null}</div></div>)}{target?.column===column.value&&!target.rejected&&!target.before?<div className="admin-kanban-insertion" style={{height:drag?.height||48}} aria-hidden="true"/>:null}</div>{renderFooter?.(column)}</section>)}</section>
 <span role="status" className={target?.rejected?'admin-kanban-feedback':'sr-only'}>{target?.rejected?rejectionReason(drag?.item,target.column):announcement}</span>{drag?createPortal(<div className="admin-kanban-overlay" aria-hidden="true" inert style={{width:drag.width,left:drag.x,top:drag.y}}>{renderItem(drag.item)}</div>,document.body):null}</>;
}
