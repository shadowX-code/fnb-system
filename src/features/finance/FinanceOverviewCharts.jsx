import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import AdminAnalyticalSurface from '../../components/layout/AdminAnalyticalSurface.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import { FinanceChart, FinanceMark, FinanceChartTip, financeChartMoney, useFinanceGeometry } from './FinanceChart.jsx';
import { FinanceReadiness, FinanceDisclosure, FinanceProvenance } from './FinanceVisualSystem.jsx';
import { financialValue, financialPeriod, movementValue } from './presentation.js';
import { metricRegistry, metricMovement } from './metrics.js';
import { overviewHistory, overviewOutlets, profitConversion } from './overviewDashboard.js';
import { openOverviewAnalysis } from './overviewNavigation.js';

const colors = { revenue:'#008b65', ebitda:'#087fca', cash:'#00869b', ebitda_margin:'#087fca', cogs:'#cc3b70', labour:'#e995b3', opex:'#8796a7' };
const format = (value, percent) => value === null ? '—' : percent ? `${value.toFixed(1)}%` : financeChartMoney(value);
const dateLabel = period => new Intl.DateTimeFormat('en-MY',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${period.start}T00:00:00Z`));
function TrendCanvas({width, rows, ids, percent, selected, onSelect}) {
  const left = width < 400 ? 46 : 58, right = 20, top = 50, bottom = 204, usable = width-left-right;
  const values = rows.flatMap(row => ids.map(id => row[id])).filter(value => Number.isFinite(value));
  const rawMax = Math.max(0,...values), rawMin = Math.min(0,...values);
  const step = 10 ** Math.floor(Math.log10(Math.max(1,rawMax-rawMin))) / 2;
  const max = Math.max(step,Math.ceil(rawMax / step)*step), min = Math.floor(rawMin / step)*step;
  const y = value => bottom-(value-min)/(max-min)*(bottom-top), x = index => left+index/Math.max(1,rows.length-1)*usable;
  const target = Object.fromEntries(rows.flatMap((row,index) => ids.filter(id => row[id] !== null).map(id => [`${row.period.start}:${id}`,[x(index),y(row[id])]])));
  const geometry = useFinanceGeometry(target);
  const path = id => {let connected=false;return rows.map(row => {const point=geometry[`${row.period.start}:${id}`];if(!point){connected=false;return '';}const segment=`${connected?'L':'M'}${point[0]},${point[1]}`;connected=true;return segment;}).join(' ');};
  const labelEvery = Math.max(1,Math.ceil(rows.length/(width<420?3:6)));
  return <>
    {[0,1,2,3,4].map(index => {const value=min+(max-min)*index/4, cy=y(value);return <g key={index}><line x1={left} x2={width-right} y1={cy} y2={cy} className="chart-grid"/>{values.length ? <text x={left-8} y={cy+4} textAnchor="end">{format(value,percent)}</text> : null}</g>;})}
    <path d={`M${left},${top}V${bottom}H${width-right}`} className="chart-axis"/>
    {rows.map((row,index) => index===0 || index===rows.length-1 || (index%labelEvery===0 && x(index)-left>=64 && width-right-x(index)>=64) ? <text key={row.period.start} x={x(index)} y={bottom+24} textAnchor={index===0?'start':index===rows.length-1?'end':'middle'}>{dateLabel(row.period)}</text> : null)}
    {!values.length ? <path d={`M${left},${top+80}H${width-right} M${left},${top+130}H${width-right}`} className="chart-pending"/> : null}
    {ids.map(id => <path key={id} d={path(id)} fill="none" stroke={colors[id]} strokeWidth="2.3" vectorEffect="non-scaling-stroke"/>)}
    {rows.map(row => ids.map(id => {const point=geometry[`${row.period.start}:${id}`];if(!point)return null;const [cx,cy]=point;return <FinanceMark key={`${row.period.start}:${id}`} label={`${financialPeriod(row.period)} ${metricRegistry[id].label}`} selected={selected===row.period.start} dimmed={Boolean(selected)&&selected!==row.period.start} onSelect={()=>onSelect(row.period.start)} tooltip={<FinanceChartTip title={financialPeriod(row.period)}>{ids.map(key=>`${metricRegistry[key].label}: ${financialValue({value:row[key],unit:percent?'percent':'money'})}`).join(' · ')} · {row.dataset?.sourceLabel}</FinanceChartTip>}>
      <circle cx={cx} cy={cy} r="22" fill="transparent"/><circle cx={cx} cy={cy} r="4" fill={colors[id]} className="chart-point"/><circle cx={cx} cy={cy} r="8" className="chart-focus"/>
    </FinanceMark>;}))}
    {ids.map((id,index) => {const last=rows.at(-1), point=last&&geometry[`${last.period.start}:${id}`];return point ? <text key={id} x={width-right} y={point[1]-10} textAnchor="end" style={{fill:colors[id],fontWeight:600}}>{metricRegistry[id].label} {format(last[id],percent)}</text> : null;})}
  </>;
}
function HistoryEvidence({rows,ids}) {
  return <FinanceDisclosure label="Monthly values & source evidence"><div className="overflow-x-auto"><table className="w-full type-caption text-left"><thead><tr><th className="py-2">Period</th>{ids.map(id=><th key={id} className="px-2">{metricRegistry[id].label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.period.start}><th className="py-2 font-medium">{financialPeriod(row.period)}</th>{ids.map(id=><td key={id} className="px-2">{financialValue({value:row[id],unit:id==='ebitda_margin'?'percent':'money'})}</td>)}</tr>)}</tbody></table></div><p>Each month retains its provider evidence; missing or incompatible observations are gaps.</p>{rows.filter(row=>row.dataset).map(row=><details key={row.period.start}><summary>{financialPeriod(row.period)} source</summary>{ids.map(id=><FinanceProvenance key={id} metric={row.dataset.metrics[id]}/>)}</details>)}</FinanceDisclosure>;
}
function Trend({dataset, cash=false}) {
  const [range,setRange]=useState('6M'),[view,setView]=useState('Amount'),[selected,setSelected]=useState(null);
  const rows=overviewHistory(dataset,range==='6M'?6:12), percent=!cash&&view==='Margin %',ids=cash?['cash']:percent?['ebitda_margin']:['revenue','ebitda'];
  const selectedRow=rows.find(row=>row.period.start===selected);
  const known=rows.filter(row=>ids.some(id=>row[id]!==null)).length;
  const movement=cash&&dataset.comparisonDataset ? metricMovement(dataset.metrics.cash,dataset.comparisonDataset.metrics.cash) : null;
  return <AdminAnalyticalSurface label={cash?'Cash Position Trend':'Revenue & EBITDA Trend'} subtitle={cash?'Monthly closing book-cash balance.':'Monthly financial performance over time.'} actions={<div className="flex flex-wrap gap-2">{!cash?<AdminSegmentedControl label="Trend units" value={view} onChange={value=>{setView(value);setSelected(null);}} options={['Amount','Margin %'].map(value=>({value,label:value}))}/>:null}<AdminSegmentedControl label={cash?'Cash history':'Performance history'} value={range} onChange={value=>{setRange(value);setSelected(null);}} options={['6M','12M'].map(value=>({value,label:value}))}/></div>}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-text-secondary">{ids.map(id=><span key={id} className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{background:colors[id]}}/>{metricRegistry[id].label} ({percent?'%':'RM'})</span>)}{cash&&movement?.value!==null&&movement ? <strong className="ml-auto text-text-primary">{movementValue(movement,'money')} vs previous month</strong>:null}</div>
    <FinanceChart label={cash?'Monthly closing book-cash history':'Monthly Revenue and EBITDA history'} height={246} dataKey={`${dataset.period.start}:${dataset.scope.id}:${view}:${range}`}>{width=><TrendCanvas width={width} rows={rows} ids={ids} percent={percent} selected={selected} onSelect={setSelected}/>}</FinanceChart>
    {selectedRow ? <p role="status" className="type-caption text-text-secondary">{financialPeriod(selectedRow.period)} · {ids.map(id=>`${metricRegistry[id].label} ${financialValue({value:selectedRow[id],unit:percent?'percent':'money'})}`).join(' · ')}</p>:null}
    {known<rows.length||rows.length===0 ? <FinanceReadiness title={known?'Partial monthly evidence':'Monthly evidence not ready'}>Only complete, compatible months are plotted. Review Data Sources for history coverage.</FinanceReadiness>:null}
    {cash?<p className="type-caption text-text-secondary">Book cash from financial records does not establish available bank funds.</p>:null}
    <HistoryEvidence rows={rows} ids={ids}/>
  </AdminAnalyticalSurface>;
}
function ConversionCanvas({width, projection, selected, onSelect}) {
  let offset = 0;
  const slots = projection.rows.map(row => {
    const slot = {...row, x:12 + offset * (width-24)/100, width:(projection.complete ? row.share/100 : .25)*(width-24)};
    offset += projection.complete ? row.share : 25;
    return slot;
  });
  const geometry = useFinanceGeometry(Object.fromEntries(projection.complete ? slots.map(row => [row.id,[row.x,row.width]]) : []));
  return slots.map(row => {
    const [x,w] = geometry[row.id] ?? [row.x,row.width];
    return <FinanceMark key={row.id} label={`Inspect ${metricRegistry[row.id].label} conversion`} selected={selected===row.id} dimmed={Boolean(selected)&&selected!==row.id} onSelect={()=>onSelect(row.id)} tooltip={<FinanceChartTip title={metricRegistry[row.id].label}>{financialValue(row.metric)} · {projection.complete?`${row.share.toFixed(2)}% of Revenue`:'Composition not validated'}</FinanceChartTip>}>
      <rect x={x} y="20" width={Math.max(0,w)} height="46" fill={projection.complete?row.id==='ebitda'?colors.revenue:colors[row.id]:'none'} className={projection.complete?'':'chart-pending'}/>
      {projection.complete&&w>45?<text x={x+w/2} y="48" textAnchor="middle" style={{fill:row.id==='labour'?'#54293a':'white',fontWeight:600}}>{row.share.toFixed(1)}%</text>:null}
      <rect x={x+2} y="17" width={Math.max(0,w-4)} height="52" className="chart-focus"/>
    </FinanceMark>;
  });
}
function Conversion({dataset}) {
  const projection=profitConversion(dataset),[selected,setSelected]=useState(null);
  return <AdminAnalyticalSurface label="Profit Conversion" subtitle={`Where each ringgit of Revenue goes · ${financialPeriod(dataset.period)}.`}>
    <FinanceChart label="100 percent Revenue composition" height={86} dataKey={`${dataset.period.start}:${dataset.scope.id}`}>
      {width=><ConversionCanvas width={width} projection={projection} selected={selected} onSelect={setSelected}/>}
    </FinanceChart>
    <ul className="divide-y divide-border">{projection.rows.map(row=><li key={row.id}><button type="button" className="flex min-h-11 w-full items-center gap-2 py-2 text-left type-body-sm focus-visible:outline-primary" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)}><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{background:row.id==='ebitda'?colors.revenue:colors[row.id]}}/><span className="flex-1">{metricRegistry[row.id].label}</span><strong>{row.share===null?'—':`${row.share.toFixed(1)}%`}</strong><span className="ml-3 text-text-secondary tabular-nums">{financialValue(row.metric)}</span></button></li>)}</ul>
    {!projection.complete?<FinanceReadiness title="Partial composition evidence">A 100% split needs complete, separate COGS, Labour, OPEX and EBITDA that reconcile to Revenue. Supplied amounts keep their own basis.</FinanceReadiness>:<p className="mt-2 type-caption text-text-secondary">Complete, compatible inputs reconcile to 100% of Revenue.</p>}
    {selected?<FinanceDisclosure label={`${metricRegistry[selected].label} definition & evidence`} open><p>{metricRegistry[selected].definition}</p><FinanceProvenance metric={dataset.metrics[selected]}/></FinanceDisclosure>:null}
  </AdminAnalyticalSurface>;
}
function OutletCanvas({width,rows,selected,onSelect}) {
  const left=46,right=14,top=24,bottom=190,space=width-left-right, vertical=width>=480 && (width-60)/Math.max(1,rows.length)>=120;
  const values=rows.map(row=>row.value).filter(Number.isFinite),max=Math.max(10,...values),min=Math.min(0,...values),step=10,high=Math.ceil(max/step)*step,low=Math.floor(min/step)*step;
  const y=v=>bottom-(v-low)/(high-low)*(bottom-top),band=space/Math.max(1,rows.length),zero=y(0);
  const target=Object.fromEntries(rows.filter(row=>row.value!==null).map((row,index)=>[row.id,vertical?[left+index*band+band*.2,y(Math.max(0,row.value)),band*.6,Math.abs(y(row.value)-zero)]:[110+(Math.min(0,row.value)-low)/(high-low)*(width-132),28+index*54,Math.abs(row.value)/(high-low)*(width-132),24]]));
  const geometry=useFinanceGeometry(target);
  if(!vertical)return <>{low<0?<line x1={110-low/(high-low)*(width-132)} x2={110-low/(high-low)*(width-132)} y1="24" y2={rows.length*54} className="chart-axis"/>:null}{rows.map((row,index)=><FinanceMark key={row.id} label={`Select ${row.name} outlet`} selected={selected===row.id} dimmed={Boolean(selected)&&selected!==row.id} onSelect={()=>onSelect(row.id)} tooltip={<FinanceChartTip title={row.name}>{financialValue(row.metric)} EBITDA margin · {row.dataset?.sourceLabel??'Evidence not ready'}</FinanceChartTip>}><text x="4" y={43+index*54}>{row.name.replace('Demo · ','').slice(0,15)+(row.name.replace('Demo · ','').length>15?'…':'')}</text>{row.value!==null?<rect x={geometry[row.id][0]} y={geometry[row.id][1]} width={geometry[row.id][2]} height={geometry[row.id][3]} fill={colors.revenue}/>:<rect x="110" y={28+index*54} width={width-132} height="24" className="chart-pending"/>}<text x={width-6} y={20+index*54} textAnchor="end" className="chart-value">{format(row.value,true)}</text><rect x="1" y={12+index*54} width={width-2} height="44" className="chart-focus"/></FinanceMark>)}</>;
  return <>{[0,1,2,3,4].map(index=>{const value=low+(high-low)*index/4;return <g key={index}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="chart-grid"/>{values.length ? <text x={left-8} y={y(value)+4} textAnchor="end">{value.toFixed(0)}%</text> : null}</g>;})}<line x1={left} x2={width-right} y1={zero} y2={zero} className="chart-axis"/>{rows.map((row,index)=>{const g=geometry[row.id];return <FinanceMark key={row.id} label={`Select ${row.name} outlet`} selected={selected===row.id} dimmed={Boolean(selected)&&selected!==row.id} onSelect={()=>onSelect(row.id)} tooltip={<FinanceChartTip title={row.name}>{financialValue(row.metric)} EBITDA margin · {row.dataset?.sourceLabel??'Evidence not ready'}</FinanceChartTip>}><rect x={g?.[0]??left+index*band+band*.2} y={g?.[1]??bottom-50} width={g?.[2]??band*.6} height={g?.[3]??50} fill={g?colors.revenue:'none'} className={g?'':'chart-pending'}/><text x={left+(index+.5)*band} y={(g?.[1]??bottom-50)-10} textAnchor="middle" className="chart-value">{format(row.value,true)}</text><text x={left+(index+.5)*band} y={bottom+24} textAnchor="middle">{row.name.replace('Demo · ','').slice(0,17)+(row.name.replace('Demo · ','').length>17?'…':'')}</text><rect x={left+index*band+2} y={top} width={band-4} height={bottom-top+4} className="chart-focus"/></FinanceMark>;})}</>;
}
function Outlets({dataset}) {
  const all=overviewOutlets(dataset),rows=all.slice(0,6),[selected,setSelected]=useState(null),outlet=all.find(row=>row.id===selected);
  return <AdminAnalyticalSurface label="Outlet Performance" subtitle={`EBITDA margin by outlet · ${financialPeriod(dataset.period)}.`} actions={<button type="button" className="btn-secondary" onClick={()=>openOverviewAnalysis(dataset)}>View all outlets <ArrowRight size={14}/></button>}>
    <FinanceChart label="Outlet EBITDA Margin comparison" height={width=>width<480 || (width-60)/Math.max(1,rows.length)<120 ? Math.max(180,rows.length*54+16):240} dataKey={`${dataset.period.start}:${dataset.scope.id}`} >{width=>rows.length?<OutletCanvas width={width} rows={rows} selected={selected} onSelect={setSelected}/>:<><path d={`M46,24V190H${width-14}`} className="chart-axis"/>{[0,1,2].map(index=><rect key={index} x={60+index*(width-80)/3} y={80+index*20} width={(width-100)/6} height={110-index*20} className="chart-pending"/>)}</>}</FinanceChart>
    {!rows.length||rows.some(row=>row.value===null)?<FinanceReadiness title="Outlet evidence not ready">Complete EBITDA and Revenue are required for each authorized outlet.</FinanceReadiness>:null}
    {outlet?<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 type-body-sm"><span><strong>{outlet.name}</strong> · {format(outlet.value,true)} EBITDA margin</span><button type="button" className="btn-secondary" onClick={()=>openOverviewAnalysis(dataset,outlet)}>Open Analysis <ArrowRight size={14}/></button></div>:null}
    <FinanceDisclosure label="Outlet values & evidence"><p>Selected scope is read independently; outlet margins are never summed. {all.length>6?'Top six outlets shown. View all outlets in Analysis.':''}</p>{all.map(row=><div key={row.id} className="py-2"><button className="btn-secondary" type="button" onClick={()=>setSelected(row.id)}>{row.name} · {format(row.value,true)}</button>{row.metric?<FinanceProvenance metric={row.metric}/>:null}</div>)}</FinanceDisclosure>
  </AdminAnalyticalSurface>;
}
export default function FinanceOverviewCharts({dataset}) {return <div className="grid min-w-0 gap-4"><div className="grid min-w-0 gap-4 xl:grid-cols-[1.35fr_1fr]"><Trend dataset={dataset}/><Conversion dataset={dataset}/></div><div className="grid min-w-0 gap-4 xl:grid-cols-2"><Outlets dataset={dataset}/><Trend dataset={dataset} cash/></div></div>;}
