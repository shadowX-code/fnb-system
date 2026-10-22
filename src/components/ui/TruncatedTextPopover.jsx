import {useId,useLayoutEffect,useRef,useState} from 'react';
import FloatingLayer from './FloatingLayer.jsx';

/** Full text is available only when the rendered preview actually overflows. */
export default function TruncatedTextPopover({text,label='Read full text',children,className='',textClassName=''}){
 const id=useId(),anchor=useRef(null),preview=useRef(null),content=useRef(null),timer=useRef(null);
 const [truncated,setTruncated]=useState(false),[open,setOpen]=useState(false);
 const cancelClose=()=>clearTimeout(timer.current);
 const closeSoon=()=>{cancelClose();timer.current=setTimeout(()=>setOpen(false),120)};
 useLayoutEffect(()=>{
  const measure=()=>{const clipped=preview.current.scrollHeight>preview.current.clientHeight+1;setTruncated(clipped);if(!clipped)setOpen(false)};
  measure();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(preview.current);window.addEventListener('resize',measure);
  return ()=>{observer?.disconnect();window.removeEventListener('resize',measure);cancelClose()};
 },[text,textClassName]);
 return <div ref={anchor} className={className} role={truncated?'button':undefined} tabIndex={truncated?0:undefined}
  aria-label={truncated?label:undefined} aria-expanded={truncated?open:undefined} aria-describedby={open?id:undefined}
  onPointerDown={event=>event.stopPropagation()}
  onPointerEnter={event=>{if(event.pointerType!=='touch'&&truncated){cancelClose();setOpen(true)}}}
  onPointerLeave={event=>{if(event.pointerType!=='touch'&&document.activeElement!==anchor.current)closeSoon()}}
  onFocus={()=>{if(truncated){cancelClose();setOpen(true)}}}
  onBlur={event=>{if(!content.current?.contains(event.relatedTarget))closeSoon()}}
  onClick={event=>{event.stopPropagation();if(truncated){cancelClose();setOpen(true)}}}
  onKeyDown={event=>{if(!truncated)return;if(event.key==='Escape'){event.stopPropagation();cancelClose();setOpen(false)}else if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();cancelClose();setOpen(true)}}}>
  {children}<p ref={preview} className={textClassName}>{text}</p>
  <FloatingLayer open={open&&truncated} onOpenChange={setOpen} anchorRef={anchor} align="start" width={360} minWidth={224} maxHeight={320} estimatedHeight={200} className="p-3">
   <div ref={content} id={id} role="tooltip" tabIndex={0} className="whitespace-pre-wrap break-words text-sm text-text-primary" style={{overflowWrap:'anywhere'}}
    onPointerEnter={cancelClose} onPointerLeave={event=>{if(event.pointerType!=='touch'&&!content.current?.contains(document.activeElement))closeSoon()}}
    onFocus={cancelClose} onBlur={event=>{if(!anchor.current?.contains(event.relatedTarget))setOpen(false)}} onClick={event=>event.stopPropagation()}>{text}</div>
  </FloatingLayer>
 </div>;
}
