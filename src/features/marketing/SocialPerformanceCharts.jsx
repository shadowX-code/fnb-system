import { useState } from 'react';
import { AdminChart, AdminChartMark, AdminChartTooltipContent, adminChartColors, adminChartLinePath, adminChartScale } from '../../components/ui/AdminChart.jsx';
import { numberLabel } from './dashboardProjection.js';
const names={facebook:'Facebook',instagram:'Instagram'};
const colors={facebook:adminChartColors.azure,instagram:adminChartColors.emerald};
const dateLabel=day=>new Intl.DateTimeFormat('en-MY',day.length===7?{month:'short',year:'numeric',timeZone:'UTC'}:{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date((day.length===7?day+'-01':day)+'T12:00:00Z'));
const compact=value=>new Intl.NumberFormat('en-MY',{notation:'compact',maximumFractionDigits:1}).format(value);
export function SocialTrendChart({metric,basis,data,channel,grain}){
 const [inspected,setInspected]=useState(null);
 const channels=channel?[channel]:['facebook','instagram'];
 const eligible=channels.filter(c=>data.filter(d=>Number.isFinite(d.channels[c]?.value)).length>=2);
 return <div className="social-trend-card"><header><h3>{metric==='views'?'Views Trend':'Interactions Trend'}</h3><span>{basis==='publication'?'Lifetime totals':basis==='growth'?'Observed growth':'Observed cumulative'}</span></header>
 {!eligible.length?<div className="social-history-empty"><strong>Insufficient history</strong><p>{basis==='publication'?'At least two publication periods with available metrics are needed.':basis==='growth'?'At least two periods with comparable baseline and ending snapshots are needed.':'At least two periods with actual ending snapshots are needed.'} Missing evidence stays unavailable.</p></div>:<>
 <div className="social-chart-legend">{channels.map(c=><span key={c}><i style={{background:colors[c]}}/>{names[c]}{eligible.includes(c)?'':' · insufficient history'}</span>)}</div>
 <AdminChart label={`${metric} ${basis} trend`} height={220} dataKey={data}>{width=>{
  const left=42,right=16,top=16,bottom=178,plot=width-left-right;
  const scale=adminChartScale(data.flatMap(d=>eligible.map(c=>d.channels[c]?.value)).filter(Number.isFinite));
  const x=i=>left+i/Math.max(1,data.length-1)*plot,y=v=>bottom-(v-scale.min)/(scale.max-scale.min)*(bottom-top);
  const ticks=[...new Set([0,Math.floor((data.length-1)/2),data.length-1])];
  return <><g aria-hidden="true">{scale.ticks.map(t=><g key={t}><line className="chart-grid" x1={left} x2={width-right} y1={y(t)} y2={y(t)}/><text x={left-8} y={y(t)+4} textAnchor="end" fill="var(--color-text-secondary)">{compact(t)}</text></g>)}{ticks.map(i=><text key={i} x={x(i)} y={205} textAnchor={i===0?'start':i===data.length-1?'end':'middle'} fill="var(--color-text-secondary)">{dateLabel(grain==='month'?data[i]?.date.slice(0,7):data[i]?.date)}</text>)}</g>
  {eligible.map(c=>{
   // A changed cumulative sample must never look like growth of the same post cohort.
   const points=[];data.forEach((d,i)=>{const v=d.channels[c];if(i&&v?.cohort&&data[i-1].channels[c]?.cohort!==v.cohort)points.push(null);points.push(Number.isFinite(v?.value)?[x(i),y(v.value)]:null)});
   return <path key={c} d={adminChartLinePath(points)} fill="none" stroke={colors[c]} strokeWidth="2" className="admin-chart-series" aria-hidden="true"/>;
  })}
  {data.map((d,i)=>{const values=eligible.map(c=>({c,v:d.channels[c]})).filter(({v})=>Number.isFinite(v?.value));if(!values.length)return null;
   return <AdminChartMark key={d.date} label={`${dateLabel(d.date)}: ${values.map(({c,v})=>`${names[c]} ${numberLabel(v.value)}, ${v.available}/${v.total} posts`).join('; ')}`} selected={inspected===d.date} onSelect={()=>setInspected(d.date)} tooltipAnchor={{x:x(i),y:top+30}} tooltip={<AdminChartTooltipContent title={`${dateLabel(d.date)} · ${basis==='publication'?'Malaysia publication date':'UTC observation period'}`} rows={values.map(({c,v})=>({label:names[c],value:`${numberLabel(v.value)} · ${v.available}/${v.total} posts`,color:colors[c]}))} note={basis==='publication'?'Latest lifetime metrics of posts published in this period.':`${d.channels[values[0].c].starting} – ${d.date}. ${basis==='growth'?'Exact matched baseline/end pairs; partial coverage is explicit.':'Ending-day snapshot totals; changing samples are disconnected.'}`}/> }><rect x={x(i)-8} y={top} width="16" height={bottom-top} fill="transparent"/><rect x={x(i)-9} y={top} width="18" height={bottom-top} className="chart-focus"/>{values.map(({c,v})=><circle key={c} className="chart-point" cx={x(i)} cy={y(v.value)} r="3.5" fill={colors[c]} stroke="var(--color-surface)" strokeWidth="1.5"/>)}</AdminChartMark>;
  })}</>;
 }}</AdminChart></>}
 </div>;
}
export function SocialComparisonChart({rows,metric}){
 const scale=adminChartScale(rows.map(r=>r.value));
 return <AdminChart label={`${metric} channel comparison`} height={180} dataKey={rows}>{width=>{
  const left=42,right=16,top=12,bottom=142,y=v=>bottom-(v-scale.min)/(scale.max-scale.min)*(bottom-top);
  return <><g aria-hidden="true">{scale.ticks.map(t=><g key={t}><line className="chart-grid" x1={left} x2={width-right} y1={y(t)} y2={y(t)}/><text x={left-8} y={y(t)+4} textAnchor="end" fill="var(--color-text-secondary)">{compact(t)}</text></g>)}</g>{rows.map((r,i)=>{const x=left+(i+.5)*(width-left-right)/rows.length;return <g key={r.channel}><text x={x} y="169" textAnchor="middle" fill="var(--color-text-secondary)">{names[r.channel]}</text>{Number.isFinite(r.value)?<AdminChartMark label={`${names[r.channel]} ${metric}: ${numberLabel(r.value)}`} onSelect={()=>{}} tooltip={<AdminChartTooltipContent title={names[r.channel]} rows={[{label:metric,value:numberLabel(r.value),color:colors[r.channel]}]} note={r.coverage}/>}><rect x={x-22} y={y(r.value)} width="44" height={bottom-y(r.value)} rx="3" fill={colors[r.channel]}/><rect x={x-26} y={top} width="52" height={bottom-top} fill="transparent"/><rect x={x-26} y={top} width="52" height={bottom-top} className="chart-focus"/><text x={x} y={y(r.value)-6} textAnchor="middle" fill="var(--color-text-primary)">{numberLabel(r.value)}</text></AdminChartMark>:<text x={x} y={bottom-8} textAnchor="middle" fill="var(--color-text-secondary)">Unavailable</text>}</g>})}</>;
 }}</AdminChart>;
}
