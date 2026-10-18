import {useId, useRef, useState} from 'react';
import {RotateCcw, SlidersHorizontal} from 'lucide-react';
import FloatingLayer from '../ui/FloatingLayer.jsx';
import './tableControls.css';

export default function ColumnSettings({columns, value, defaults, onChange, label = 'Column Settings'}) {
  const [open,setOpen]=useState(false), anchor=useRef(null), id=useId();
  const close=next=>{setOpen(next);if(!next)anchor.current?.focus()};
  const selected=columns.filter(c=>c.required||value.includes(c.key)).length;
  return <>
    <button ref={anchor} type="button" className="btn-secondary" aria-expanded={open} aria-haspopup="dialog" aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><SlidersHorizontal size={15} aria-hidden="true"/>{label}<span className="admin-column-count">{selected}/{columns.length}</span></button>
    <FloatingLayer open={open} onOpenChange={close} anchorRef={anchor} width={288} minWidth={240} maxHeight={560} estimatedHeight={540} align="start" focusOnOpen className="admin-column-settings">
      <div role="dialog" aria-label={label} id={id}>
        <header><strong>Visible columns</strong><span>{selected} of {columns.length}</span></header>
        <fieldset><legend className="sr-only">Columns</legend>{columns.map(c=><label key={c.key} className="admin-column-option"><input type="checkbox" checked={c.required||value.includes(c.key)} disabled={c.required} onChange={e=>onChange(e.target.checked?[...value,c.key]:value.filter(k=>k!==c.key))}/><span>{c.label}</span>{c.required?<small>Required</small>:null}</label>)}</fieldset>
        <footer><button type="button" className="btn-secondary btn-sm" onClick={()=>onChange([...defaults])}><RotateCcw size={14} aria-hidden="true"/>Reset to Default</button><button type="button" className="btn-primary btn-sm" onClick={()=>close(false)}>Done</button></footer>
      </div>
    </FloatingLayer>
  </>;
}
