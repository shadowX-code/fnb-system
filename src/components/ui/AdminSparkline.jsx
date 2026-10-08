import {useId, useState} from 'react';
import {useAdminChartGeometry} from './AdminChart.jsx';

/** Small, zero-inclusive trends. Dated evidence and exact values remain inspectable. */
export default function AdminSparkline({points, label, formatValue = String, className = ''}) {
  const [inspected,setInspected] = useState(null), id=useId();
  const min=Math.min(0,...points.map(point=>point.value)), max=Math.max(0,...points.map(point=>point.value));
  const geometry=useAdminChartGeometry(Object.fromEntries(points.map((point,index)=>[point.label,[4+index/(points.length-1)*112,28-(point.value-min)/(max-min||1)*24]])));
  const active=points[inspected], last=geometry[points.at(-1).label];
  const inspectPointer=e=>{if(document.activeElement!==e.currentTarget && document.activeElement?.matches('[data-admin-chart-mark],[data-admin-chart-inspection]'))return;const box=e.currentTarget.getBoundingClientRect();setInspected(Math.max(0,Math.min(points.length-1,Math.round(((e.clientX-box.left)/box.width*120-4)/112*(points.length-1)))));};
  return <span className={`admin-chart-sparkline ${className}`} onPointerLeave={()=>setInspected(null)}>
    <svg data-admin-chart-inspection="true" viewBox="0 0 120 32" role="img" tabIndex={0} aria-label={label} aria-describedby={active?id:undefined}
      onPointerMove={inspectPointer} onClick={e=>{e.stopPropagation();inspectPointer(e);}} onFocus={()=>setInspected(points.length-1)} onBlur={()=>setInspected(null)}
      onKeyDown={e=>{if(e.key==='Escape'){setInspected(null);return;}if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();setInspected(index=>e.key==='Home'?0:e.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(index??points.length-1)+(e.key==='ArrowLeft'?-1:1))));}}}>
      <title>{points.map(point=>`${point.label}: ${formatValue(point.value)}`).join('; ')} · zero-inclusive scale</title>
      <path d={points.map((point,index)=>`${index?'L':'M'}${geometry[point.label].join(',')}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor"/>
      {active?<circle cx={geometry[active.label][0]} cy={geometry[active.label][1]} r="3" fill="white" stroke="currentColor" strokeWidth="1.5"/>:null}
    </svg>
    {active?<span role="tooltip" id={id} className="admin-chart-tooltip"><strong>{active.label}</strong><span>{formatValue(active.value)}</span></span>:null}
  </span>;
}
