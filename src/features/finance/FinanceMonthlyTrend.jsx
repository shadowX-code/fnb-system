import { useState } from 'react';
import { AdminChartArea, adminChartLinePath, AdminChartCrosshair, AdminChartValueLabel, adminChartScale } from '../../components/ui/AdminChart.jsx';
import { FinanceMark, FinanceChartTip, financeChartColors, financeChartMoney, useFinanceGeometry } from './FinanceChart.jsx';
import { FinanceDisclosure, FinanceProvenance } from './FinanceVisualSystem.jsx';
import { financialValue, financialPeriod } from './presentation.js';
import { analysisMargin, metricRegistry } from './metrics.js';
const colors = financeChartColors;
const format = (value, percent) => value === null ? '—' : percent ? `${value.toFixed(1)}%` : financeChartMoney(value);
const dateLabel = period => new Intl.DateTimeFormat('en-MY',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${period.start}T00:00:00Z`));
export function FinanceMonthlyTrendCanvas({width, height = 246, rows, ids, percent, selected, onSelect, tooltipRows}) {
  const [inspected,setInspected] = useState(null);
  const left = width < 400 ? 46 : 58, right = 20, top = 32, bottom = height - 42, usable = width-left-right;
  const values = rows.flatMap(row => ids.map(id => row[id])).filter(Number.isFinite);
  const {min,max,ticks} = adminChartScale(values, width<420?3:4);
  const y = value => bottom-(value-min)/(max-min)*(bottom-top), x = index => left+index/Math.max(1,rows.length-1)*usable;
  const target = Object.fromEntries(rows.flatMap((row,index) => ids.filter(id => row[id] !== null).map(id => [`${row.period.start}:${id}`,[x(index),y(row[id])]])));
  const geometry = useFinanceGeometry(target);
  const path = id => adminChartLinePath(rows.map(row => geometry[`${row.period.start}:${id}`]));
  const labelEvery = Math.max(1,Math.ceil(rows.length/(width<420?3:6)));
  return <>
    {ticks.map(value => {const cy=y(value);return <g key={value}><line x1={left} x2={width-right} y1={cy} y2={cy} className="chart-grid"/>{values.length ? <text x={left-8} y={cy+4} textAnchor="end">{format(value,percent)}</text> : null}</g>;})}
    <path d={`M${left},${top}V${bottom}H${width-right}`} className="chart-axis"/>
    {rows.map((row,index) => index===0 || index===rows.length-1 || (index%labelEvery===0 && x(index)-left>=64 && width-right-x(index)>=64) ? <text key={row.period.start} x={x(index)} y={bottom+24} textAnchor={index===0?'start':index===rows.length-1?'end':'middle'}>{dateLabel(row.period)}</text> : null)}
    {!values.length ? <path d={`M${left},${top+80}H${width-right} M${left},${top+130}H${width-right}`} className="chart-pending"/> : null}
    {ids.map(id => <AdminChartArea key={id} color={colors[id]} opacity={selected?.75:1} d={rows.map((row,index)=>{const point=geometry[`${row.period.start}:${id}`], next=geometry[`${rows[index+1]?.period.start}:${id}`];return point&&next?`M${point[0]},${y(0)}L${point[0]},${point[1]}L${next[0]},${next[1]}L${next[0]},${y(0)}Z`:'';}).join(' ')}/>)}
    {ids.map(id => <path key={id} d={path(id)} fill="none" stroke={colors[id]} strokeWidth="2.5" vectorEffect="non-scaling-stroke" className="admin-chart-series" opacity={selected ? .75 : 1}/>)}
    <AdminChartCrosshair x={rows.findIndex(row=>row.period.start===(inspected??selected))>=0 ? x(rows.findIndex(row=>row.period.start===(inspected??selected))) : null} top={top} bottom={bottom}/>
    {rows.map((row,index) => {
      if(!ids.some(id=>geometry[`${row.period.start}:${id}`]))return null;
      const cx=x(index), half=usable/Math.max(1,rows.length-1)/2, cy=Math.min(...ids.map(id=>geometry[`${row.period.start}:${id}`]?.[1]).filter(Number.isFinite));
      return <FinanceMark key={row.period.start} tooltipAnchor={{x:cx,y:cy}} label={`${financialPeriod(row.period)} ${ids.map(id=>metricRegistry[id].label).join(' and ')}`} selected={selected===row.period.start} dimmed={Boolean(selected)&&selected!==row.period.start} onInspect={active=>setInspected(active?row.period.start:null)} onSelect={()=>onSelect(selected===row.period.start?null:row.period.start)} tooltip={<FinanceChartTip title={financialPeriod(row.period)} rows={[...ids.map(key=>({label:metricRegistry[key].label,value:financialValue({value:row[key],unit:percent?'percent':'money'}),color:colors[key]})),...(tooltipRows?.(row)??[])]} note={row.dataset?.sourceLabel}/>}>
        <rect className="chart-inspection-band" x={Math.max(left,cx-half)} y={top-12} width={Math.min(width-right,cx+half)-Math.max(left,cx-half)} height={bottom-top+24} />
        <rect x={Math.max(left,cx-half)} y={top-12} width={Math.min(width-right,cx+half)-Math.max(left,cx-half)} height={bottom-top+24} fill="transparent"/>
        {ids.map(id=>{const point=geometry[`${row.period.start}:${id}`];return point ? <g key={id} pointerEvents="none"><circle cx={point[0]} cy={point[1]} r={selected===row.period.start||inspected===row.period.start?5:index===rows.length-1?4:2.5} fill={colors[id]} className="chart-point"/><circle cx={point[0]} cy={point[1]} r="8" className="chart-focus"/></g>:null;})}
      </FinanceMark>;
    })}
    {(() => {
      const occupied=[];
      return ids.map(id=>{const last=rows.at(-1), point=last&&geometry[`${last.period.start}:${id}`];if(!point)return null;
        let labelY=point[1]-14;
        while(occupied.some(y=>Math.abs(y-labelY)<28))labelY+=28;
        labelY=Math.min(bottom+10,Math.max(20,labelY));occupied.push(labelY);
        return <g key={id} pointerEvents="none">{Math.abs(labelY-(point[1]-10))>1?<line x1={point[0]} x2={width-right} y1={point[1]} y2={labelY-4} stroke={colors[id]} strokeWidth="1"/>:null}<AdminChartValueLabel x={width-right} y={labelY} color={colors[id]} value={format(last[id],percent)}/></g>;
      });
    })()}

  </>;
}
export function FinanceHistoryEvidence({rows,ids}) {
  return <FinanceDisclosure label="Monthly values & source evidence"><div className="overflow-x-auto"><table className="w-full type-caption text-left"><thead><tr><th className="py-2">Period</th>{ids.map(id=><th key={id} className="px-2">{metricRegistry[id].label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.period.start}><th className="py-2 font-medium">{financialPeriod(row.period)}</th>{ids.map(id=><td key={id} className="px-2">{financialValue({value:row[id],unit:id==='ebitda_margin'?'percent':'money'})}</td>)}</tr>)}</tbody></table></div><p>Each month retains its provider evidence; missing or incompatible observations are gaps.</p>{rows.filter(row=>row.dataset).map(row=><details key={row.period.start}><summary>{financialPeriod(row.period)} source</summary>{ids.map(id=><FinanceProvenance key={id} metric={id==='ebitda_margin'?analysisMargin(row.dataset):row.dataset.metrics[id]}/>)}</details>)}</FinanceDisclosure>;
}
