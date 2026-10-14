import {useEffect, useId, useState} from 'react';
import {AdminChartFloatingTooltip,useAdminChartGeometry} from './AdminChart.jsx';

/** Small, zero-inclusive trends. Dated evidence and exact values remain inspectable. */
export default function AdminSparkline({points, label, formatValue = String, className = '', color}) {
  const [inspected,setInspected] = useState(null), [anchor,setAnchor] = useState(null), id=useId();
  const locate = element => {const box=element.getBoundingClientRect();setAnchor({x:box.left+box.width/2,top:box.top,bottom:box.bottom});};
  useEffect(()=>{const dismiss=()=>setInspected(null);window.addEventListener('scroll',dismiss,true);window.addEventListener('resize',dismiss);return()=>{window.removeEventListener('scroll',dismiss,true);window.removeEventListener('resize',dismiss);};},[]);
  const min=Math.min(0,...points.map(point=>point.value)), max=Math.max(0,...points.map(point=>point.value));
  const geometry=useAdminChartGeometry(Object.fromEntries(points.map((point,index)=>[point.label,[4+index/(points.length-1)*112,28-(point.value-min)/(max-min||1)*24]])));
  const active=points[inspected], last=geometry[points.at(-1).label];
  const inspectPointer=e=>{if(document.activeElement!==e.currentTarget && document.activeElement?.matches('[data-admin-chart-mark][data-keyboard-focus=true],[data-admin-chart-inspection]'))return;const box=e.currentTarget.getBoundingClientRect();locate(e.currentTarget);setInspected(Math.max(0,Math.min(points.length-1,Math.round(((e.clientX-box.left)/box.width*120-4)/112*(points.length-1)))));};
  return <span style={color ? {color} : undefined} className={`admin-chart-sparkline ${className}`} onPointerLeave={()=>setInspected(null)}>
    <svg data-admin-chart-inspection="true" viewBox="0 0 120 32" role="img" tabIndex={0} aria-label={label} aria-describedby={active?id:undefined}
      onPointerMove={inspectPointer} onClick={e=>{e.stopPropagation();inspectPointer(e);}} onFocus={e=>{locate(e.currentTarget);setInspected(points.length-1);}} onBlur={()=>setInspected(null)}
      onKeyDown={e=>{if(e.key==='Escape'){setInspected(null);return;}if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();setInspected(index=>e.key==='Home'?0:e.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(index??points.length-1)+(e.key==='ArrowLeft'?-1:1))));}}}>
      <title>{points.map(point=>`${point.label}: ${formatValue(point.value)}`).join('; ')} · zero-inclusive scale</title>
      <path d={points.map((point,index)=>`${index?'L':'M'}${geometry[point.label].join(',')}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>
      <circle cx={last[0]} cy={last[1]} r="2.6" fill="currentColor"/>
      {active?<circle cx={geometry[active.label][0]} cy={geometry[active.label][1]} r="3" fill="white" stroke="currentColor" strokeWidth="1.5"/>:null}
    </svg>
    {active && anchor?<AdminChartFloatingTooltip id={id} anchor={anchor}><strong>{active.label}</strong><span>{formatValue(active.value)}</span></AdminChartFloatingTooltip>:null}
  </span>;
}
