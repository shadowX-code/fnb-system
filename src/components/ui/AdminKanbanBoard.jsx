import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {GripVertical} from 'lucide-react';
import './adminKanban.css';

/** Interaction only. The consumer validates transitions and owns persistence. */
export default function AdminKanbanBoard({columns,label,disabled,canDrop,onDrop,renderItem,renderHeader,renderFooter,columnClassName=()=>'',className=''}){
 const root=useRef(null),cleanup=useRef(()=>{}),latest=useRef({}),positions=useRef(new Map()),[drag,setDrag]=useState(null),[target,setTarget]=useState(null),[announcement,setAnnouncement]=useState('');
 latest.current={columns,disabled,canDrop,onDrop};
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 useEffect(()=>()=>cleanup.current(),[]);
 useEffect(()=>{if(disabled)cleanup.current()},[disabled]);
 useLayoutEffect(()=>{
  const next=new Map();root.current?.querySelectorAll('[data-kanban-item]').forEach(node=>{
   const box=node.getBoundingClientRect(),old=positions.current.get(node.dataset.kanbanItem);next.set(node.dataset.kanbanItem,box);
   if(old&&!reduced()&&node.animate&&(old.x!==box.x||old.y!==box.y))node.animate([{transform:`translate(${old.x-box.x}px,${old.y-box.y}px)`},{transform:'translate(0,0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
  });positions.current=next;
 },[columns,target]);
 function placement(x,y,item){
  const column=[...(root.current?.querySelectorAll('[data-kanban-column]')||[])].find(node=>{const b=node.getBoundingClientRect();return x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom});
  if(!column||!latest.current.canDrop(item,column.dataset.kanbanColumn))return null;
  const rows=[...column.querySelectorAll('[data-kanban-item]')].filter(node=>node.dataset.kanbanItem!==item.id);
  const before=rows.find(node=>{const box=node.getBoundingClientRect();return y<box.top+box.height/2});
  return {column:column.dataset.kanbanColumn,before:before?.dataset.kanbanItem||null};
 }
 function start(event,item){
  if(latest.current.disabled||event.button!==0)return;
  event.preventDefault();event.currentTarget.focus();
  const card=event.currentTarget.closest('[data-kanban-item]'),box=card.getBoundingClientRect(),origin={x:event.clientX,y:event.clientY},pointerId=event.pointerId;
  let active=false,point={...origin},frame=0,stopped=false;
  const scroll=()=>{
   if(stopped||!active)return;
   let node=root.current;const edge=48,speed=(value,low,high)=>value<low+edge?-Math.ceil((low+edge-value)/4):value>high-edge?Math.ceil((value-high+edge)/4):0;
   while(node){const style=getComputedStyle(node),bounds=node.getBoundingClientRect();if(/auto|scroll/.test(style.overflowX)&&node.scrollWidth>node.clientWidth)node.scrollLeft+=speed(point.x,bounds.left,bounds.right);if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight)node.scrollTop+=speed(point.y,bounds.top,bounds.bottom);node=node.parentElement;}
   window.scrollBy?.(0,speed(point.y,0,window.innerHeight));
   setTarget(placement(point.x,point.y,item));frame=requestAnimationFrame(scroll);
  };
  const move=e=>{
   if(e.pointerId!==pointerId)return;point={x:e.clientX,y:e.clientY};
   if(!active&&Math.hypot(point.x-origin.x,point.y-origin.y)<6)return;
   e.preventDefault();if(!active){active=true;document.body.classList.add('admin-kanban-dragging');setAnnouncement(`Moving ${item.title}. Escape cancels.`);frame=requestAnimationFrame(scroll);}
   setDrag({item,width:box.width,height:box.height,x:box.left+point.x-origin.x,y:box.top+point.y-origin.y});setTarget(placement(point.x,point.y,item));
  };
  const clear=()=>{stopped=true;cancelAnimationFrame(frame);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape);document.body.classList.remove('admin-kanban-dragging');setDrag(null);setTarget(null);cleanup.current=()=>{}};
  const finish=e=>{if(e.pointerId!==pointerId)return;const destination=active?placement(e.clientX,e.clientY,item):null;clear();if(destination&&!latest.current.disabled){setAnnouncement(`${item.title} moved to ${latest.current.columns.find(c=>c.value===destination.column)?.label}.`);latest.current.onDrop(item,destination.column,destination.before)}};
  const cancel=()=>{clear();setAnnouncement('Move cancelled.')},escape=e=>{if(e.key==='Escape'){e.preventDefault();cancel()}};
  cleanup.current();cleanup.current=clear;
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape);
 }
 function keyboard(event,item,column,index){
  if(disabled)return;
  let destination=null,before=null;
  if(['ArrowLeft','ArrowRight'].includes(event.key)){const next=columns[columns.findIndex(c=>c.value===column.value)+(event.key==='ArrowLeft'?-1:1)];if(next&&canDrop(item,next.value))destination=next.value;}
  if(['ArrowUp','ArrowDown'].includes(event.key)&&canDrop(item,column.value)){const direction=event.key==='ArrowUp'?-1:1;if(index+direction>=0&&index+direction<column.items.length){destination=column.value;before=direction<0?column.items[index-1].id:column.items[index+2]?.id||null;}}
  if(destination){event.preventDefault();onDrop(item,destination,before);setAnnouncement(`${item.title} moved to ${columns.find(c=>c.value===destination)?.label}.`);}
 }
 return <><section ref={root} className={`admin-kanban-board ${className}`} aria-label={label}>{columns.map(column=><section key={column.value} data-kanban-column={column.value} className={`admin-kanban-column ${columnClassName(column)}`} aria-label={column.label} data-drop-active={target?.column===column.value||undefined}>
 <header>{renderHeader(column)}</header><div className="admin-kanban-items">{column.items.map((item,index)=><div key={item.id} data-kanban-item={item.id} className="admin-kanban-item" data-dragging={drag?.item.id===item.id||undefined}>
 {target?.column===column.value&&target.before===item.id?<div className="admin-kanban-insertion" aria-hidden="true"/>:null}
 <div className="admin-kanban-card">{renderItem(item)}{columns.some(c=>canDrop(item,c.value))?<button type="button" className="admin-kanban-handle" aria-label={`Move ${item.title}. Use arrow keys to move, or open task for touch controls.`} title="Drag to move. Arrow keys move between columns; up/down reorder in Manual Order." disabled={disabled} onPointerDown={e=>start(e,item)} onKeyDown={e=>keyboard(e,item,column,index)}><GripVertical size={15}/></button>:null}</div></div>)}{target?.column===column.value&&!target.before?<div className="admin-kanban-insertion" aria-hidden="true"/>:null}</div>{renderFooter?.(column)}</section>)}</section>
 <span role="status" className="sr-only">{announcement}</span>{drag?createPortal(<div className="admin-kanban-overlay" aria-hidden="true" style={{width:drag.width,left:drag.x,top:drag.y}}>{renderItem(drag.item)}</div>,document.body):null}</>;
}
