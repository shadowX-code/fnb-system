import { useLayoutEffect, useRef } from 'react';
import AdminFormField from './AdminFormField.jsx';

/** Shared multiline field: preserve a readable row floor while growing with content. */
export default function TextareaField({label,value,onChange,rows=5,helper,error,disabled=false,maxLength,required=false,ariaLabel,autoFocus=false,onBlur,onKeyDown}) {
 const ref=useRef(null);
 useLayoutEffect(()=>{
  const resize=()=>{const element=ref.current;if(!element)return;const style=getComputedStyle(element);const floor=rows*(parseFloat(style.lineHeight)||21)+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);element.style.height='auto';element.style.height=`${Math.max(floor,element.scrollHeight)}px`;};
  resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
 },[value,rows]);
 return <AdminFormField label={label} helper={helper} error={error} required={required}><textarea ref={ref} aria-label={ariaLabel} autoFocus={autoFocus} onBlur={onBlur} onKeyDown={onKeyDown} className="control admin-textarea" rows={rows} value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} maxLength={maxLength} required={required}/></AdminFormField>;
}
