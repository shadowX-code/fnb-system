import { useId, useState } from 'react';
import { FinanceMonthlyTrendCanvas, FinanceHistoryEvidence } from './FinanceMonthlyTrend.jsx';
import { ArrowRight } from 'lucide-react';
import AdminAnalyticalSurface from '../../components/layout/AdminAnalyticalSurface.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import { FinanceChart, FinanceMark, FinanceChartTip, financeChartColors, financeConversionColors, financeChartMoney, useFinanceGeometry } from './FinanceChart.jsx';
import { FinanceReadiness, FinanceDisclosure, FinanceProvenance } from './FinanceVisualSystem.jsx';
import { financialValue, financialPeriod, movementValue } from './presentation.js';
import { metricRegistry, metricMovement } from './metrics.js';
import { overviewHistory, overviewOutlets, profitConversion } from './overviewDashboard.js';
import { openOverviewAnalysis } from './overviewNavigation.js';

const colors = financeChartColors;
const format = (value, percent) => value === null ? '—' : percent ? `${value.toFixed(1)}%` : financeChartMoney(value);
function Trend({dataset, cash=false}) {
  const [range,setRange]=useState('6M'),[view,setView]=useState('Amount'),[selected,setSelected]=useState(null);
  const rows=overviewHistory(dataset,range==='6M'?6:12), percent=!cash&&view==='Margin %',ids=cash?['cash']:percent?['ebitda_margin']:['revenue','ebitda'];
  const selectedRow=rows.find(row=>row.period.start===selected);
  const known=rows.filter(row=>ids.some(id=>row[id]!==null)).length;
  const movement=cash&&dataset.comparisonDataset ? metricMovement(dataset.metrics.cash,dataset.comparisonDataset.metrics.cash) : null;
  return <AdminAnalyticalSurface label={cash?'Cash Position Trend':'Revenue & EBITDA Trend'} subtitle={cash?'Monthly closing book-cash balance.':'Monthly financial performance over time.'} actions={<div className="flex flex-wrap gap-2">{!cash?<AdminSegmentedControl label="Trend units" value={view} onChange={value=>{setView(value);setSelected(null);}} options={['Amount','Margin %'].map(value=>({value,label:value}))}/>:null}<AdminSegmentedControl label={cash?'Cash history':'Performance history'} value={range} onChange={value=>{setRange(value);setSelected(null);}} options={['6M','12M'].map(value=>({value,label:value}))}/></div>}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 type-caption text-text-secondary">{ids.map(id=><span key={id} className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{background:colors[id]}}/>{metricRegistry[id].label} ({percent?'%':'RM'})</span>)}{cash&&movement?.value!==null&&movement ? <strong className="ml-auto text-text-primary">{movementValue(movement,'money')} vs previous month</strong>:null}</div>
    <FinanceChart label={cash?'Monthly closing book-cash history':'Monthly Revenue and EBITDA history'} height={246} dataKey={`${dataset.period.start}:${dataset.scope.id}:${view}:${range}`}>{width=><FinanceMonthlyTrendCanvas width={width} rows={rows} ids={ids} percent={percent} selected={selected} onSelect={setSelected}/>}</FinanceChart>
    {selectedRow ? <p role="status" className="type-caption text-text-secondary">{financialPeriod(selectedRow.period)} · {ids.map(id=>`${metricRegistry[id].label} ${financialValue({value:selectedRow[id],unit:percent?'percent':'money'})}`).join(' · ')}</p>:null}
    {known<rows.length||rows.length===0 ? <FinanceReadiness title={known?'Partial monthly evidence':'Monthly evidence not ready'}>Only complete, compatible months are plotted. Review Data Sources for history coverage.</FinanceReadiness>:null}
    {cash?<p className="type-caption text-text-secondary">Book cash from financial records does not establish available bank funds.</p>:null}
    <FinanceHistoryEvidence rows={rows} ids={ids}/>
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
  return <><defs><clipPath id={projection.clipId}><rect x="12" y="20" width={width-24} height="46" rx="5"/></clipPath></defs>{slots.map(row => {
    const [x,w] = geometry[row.id] ?? [row.x,row.width];
    return <FinanceMark key={row.id} label={`Inspect ${metricRegistry[row.id].label} conversion`} selected={selected===row.id} dimmed={Boolean(selected)&&selected!==row.id} onSelect={()=>onSelect(row.id)} tooltip={<FinanceChartTip title={metricRegistry[row.id].label} rows={[{label:'Amount',value:financialValue(row.metric),color:financeConversionColors[row.id]},{label:'Revenue share',value:projection.complete?`${row.share.toFixed(2)}%`:'Not validated'}]}/>}>
      <rect x={x} y="20" width={Math.max(0,w)} height="46" clipPath={`url(#${projection.clipId})`} stroke="white" strokeWidth="1" fill={projection.complete?financeConversionColors[row.id]:'none'} className={projection.complete?'':'chart-pending'}/>
      {projection.complete&&w>45?<text x={x+w/2} y="48" textAnchor="middle" style={{fill:'var(--color-text-primary, #132638)',fontWeight:600}}>{row.share.toFixed(1)}%</text>:null}
      <rect x={x+2} y="17" width={Math.max(0,w-4)} height="52" className="chart-focus"/>
    </FinanceMark>;
  })}</>;
}
function Conversion({dataset}) {
  const clipId=useId(), projection={...profitConversion(dataset),clipId},[selected,setSelected]=useState(null);
  return <AdminAnalyticalSurface label="Profit Conversion" subtitle={`Where each ringgit of Revenue goes · ${financialPeriod(dataset.period)}.`}>
    <FinanceChart label="100 percent Revenue composition" height={86} dataKey={`${dataset.period.start}:${dataset.scope.id}`}>
      {width=><ConversionCanvas width={width} projection={projection} selected={selected} onSelect={setSelected}/>}
    </FinanceChart>
    <ul className="divide-y divide-border">{projection.rows.map(row=><li key={row.id}><button type="button" className="flex min-h-11 w-full items-center gap-2 py-2 text-left type-body-sm focus-visible:outline-primary" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)}><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{background:financeConversionColors[row.id]}}/><span className="flex-1">{metricRegistry[row.id].label}</span><strong>{row.share===null?'—':`${row.share.toFixed(1)}%`}</strong><span className="ml-3 text-text-secondary tabular-nums">{financialValue(row.metric)}</span></button></li>)}</ul>
    {!projection.complete?<FinanceReadiness title="Partial composition evidence">A 100% split needs complete, separate COGS, Labour, OPEX and EBITDA that reconcile to Revenue. Supplied amounts keep their own basis.</FinanceReadiness>:<p className="mt-2 type-caption text-text-secondary">Complete, compatible inputs reconcile to 100% of Revenue.</p>}
    {selected?<FinanceDisclosure label={`${metricRegistry[selected].label} definition & evidence`} open><p>{metricRegistry[selected].definition}</p><FinanceProvenance metric={dataset.metrics[selected]}/></FinanceDisclosure>:null}
  </AdminAnalyticalSurface>;
}
function OutletCanvas({width,rows,selected,onSelect}) {
  const left=46,right=14,top=24,bottom=190,space=width-left-right, vertical=width>=480 && (width-60)/Math.max(1,rows.length)>=120;
  const values=rows.map(row=>row.value).filter(Number.isFinite),max=Math.max(10,...values),min=Math.min(0,...values),step=10,high=Math.ceil(max/step)*step,low=Math.floor(min/step)*step;
  const y=v=>bottom-(v-low)/(high-low)*(bottom-top),band=space/Math.max(1,rows.length),zero=y(0);
  const target=Object.fromEntries(rows.filter(row=>row.value!==null).map((row,index)=>[row.id,vertical?[left+index*band+(band-Math.min(76,band*.55))/2,y(Math.max(0,row.value)),Math.min(76,band*.55),Math.abs(y(row.value)-zero)]:[110+(Math.min(0,row.value)-low)/(high-low)*(width-132),28+index*54,Math.abs(row.value)/(high-low)*(width-132),24]]));
  const geometry=useFinanceGeometry(target);
  if(!vertical)return <>{[low,low+(high-low)/2,high].map(value=><g key={value}><line x1={110+(value-low)/(high-low)*(width-132)} x2={110+(value-low)/(high-low)*(width-132)} y1="24" y2={rows.length*54+4} className="chart-grid"/><text x={110+(value-low)/(high-low)*(width-132)} y={rows.length*54+19} textAnchor={value===low?'start':value===high?'end':'middle'}>{values.length?`${value}%`:null}</text></g>)}{low<0?<line x1={110-low/(high-low)*(width-132)} x2={110-low/(high-low)*(width-132)} y1="24" y2={rows.length*54} className="chart-axis"/>:null}{rows.map((row,index)=><FinanceMark key={row.id} label={`Select ${row.name} outlet`} selected={selected===row.id} dimmed={Boolean(selected)&&selected!==row.id} onSelect={()=>onSelect(row.id)} tooltip={<FinanceChartTip title={row.name} rows={[{label:'EBITDA margin',value:financialValue(row.metric)}]} note={row.dataset?.sourceLabel??'Evidence not ready'}/>}><rect x="0" y={12+index*54} width={width} height="44" fill="transparent"/><text x="4" y={43+index*54}>{row.name.replace('Demo · ','').slice(0,15)+(row.name.replace('Demo · ','').length>15?'…':'')}</text>{row.value!==null?<rect x={geometry[row.id][0]} y={geometry[row.id][1]} width={geometry[row.id][2]} height={geometry[row.id][3]} rx="3" fill={row.value<0?'var(--chart-coral)':colors.revenue}/>:<rect x="110" y={28+index*54} width={width-132} height="24" className="chart-pending"/>}<text x={width-6} y={20+index*54} textAnchor="end" className="chart-value">{format(row.value,true)}</text><rect x="1" y={12+index*54} width={width-2} height="44" className="chart-focus"/></FinanceMark>)}</>;
  return <>{[0,1,2,3,4].map(index=>{const value=low+(high-low)*index/4;return <g key={index}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="chart-grid"/>{values.length ? <text x={left-8} y={y(value)+4} textAnchor="end">{value.toFixed(0)}%</text> : null}</g>;})}<line x1={left} x2={width-right} y1={zero} y2={zero} className="chart-axis"/>{rows.map((row,index)=>{const g=geometry[row.id];return <FinanceMark key={row.id} label={`Select ${row.name} outlet`} selected={selected===row.id} dimmed={Boolean(selected)&&selected!==row.id} onSelect={()=>onSelect(row.id)} tooltip={<FinanceChartTip title={row.name} rows={[{label:'EBITDA margin',value:financialValue(row.metric)}]} note={row.dataset?.sourceLabel??'Evidence not ready'}/>}><rect x={left+index*band} y={top} width={band} height={bottom-top+30} fill="transparent"/><rect x={g?.[0]??left+index*band+band*.2} y={g?.[1]??bottom-50} width={g?.[2]??band*.6} height={g?.[3]??50} rx="3" fill={g?row.value<0?'var(--chart-coral)':colors.revenue:'none'} className={g?'':'chart-pending'}/><text x={left+(index+.5)*band} y={(g?.[1]??bottom-50)-10} textAnchor="middle" className="chart-value">{format(row.value,true)}</text><text x={left+(index+.5)*band} y={bottom+24} textAnchor="middle">{row.name.replace('Demo · ','').slice(0,17)+(row.name.replace('Demo · ','').length>17?'…':'')}</text><rect x={left+index*band+2} y={top} width={band-4} height={bottom-top+4} className="chart-focus"/></FinanceMark>;})}</>;
}
function Outlets({dataset}) {
  const all=overviewOutlets(dataset),rows=all.slice(0,6),[selected,setSelected]=useState(null),outlet=all.find(row=>row.id===selected);
  return <AdminAnalyticalSurface label="Outlet Performance" subtitle={`EBITDA margin by outlet · ${financialPeriod(dataset.period)}.`} actions={<button type="button" className="btn-secondary" onClick={()=>openOverviewAnalysis(dataset)}>View all outlets <ArrowRight size={14}/></button>}>
    <FinanceChart label="Outlet EBITDA Margin comparison" height={width=>width<480 || (width-60)/Math.max(1,rows.length)<120 ? Math.max(180,rows.length*54+28):240} dataKey={`${dataset.period.start}:${dataset.scope.id}`} >{width=>rows.length?<OutletCanvas width={width} rows={rows} selected={selected} onSelect={setSelected}/>:<><path d={`M46,24V190H${width-14}`} className="chart-axis"/>{[0,1,2].map(index=><rect key={index} x={60+index*(width-80)/3} y={80+index*20} width={(width-100)/6} height={110-index*20} className="chart-pending"/>)}</>}</FinanceChart>
    {!rows.length||rows.some(row=>row.value===null)?<FinanceReadiness title="Outlet evidence not ready">Complete EBITDA and Revenue are required for each authorized outlet.</FinanceReadiness>:null}
    {outlet?<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 type-body-sm"><span><strong>{outlet.name}</strong> · {format(outlet.value,true)} EBITDA margin</span><button type="button" className="btn-secondary" onClick={()=>openOverviewAnalysis(dataset,outlet)}>Open Analysis <ArrowRight size={14}/></button></div>:null}
    <FinanceDisclosure label="Outlet values & evidence"><p>Selected scope is read independently; outlet margins are never summed. {all.length>6?'Top six outlets shown. View all outlets in Analysis.':''}</p>{all.map(row=><div key={row.id} className="py-2"><button className="btn-secondary" type="button" onClick={()=>setSelected(row.id)}>{row.name} · {format(row.value,true)}</button>{row.metric?<FinanceProvenance metric={row.metric}/>:null}</div>)}</FinanceDisclosure>
  </AdminAnalyticalSurface>;
}
export default function FinanceOverviewCharts({dataset}) {return <div className="grid min-w-0 gap-4"><div className="grid min-w-0 gap-4 xl:grid-cols-[1.35fr_1fr]"><Trend dataset={dataset}/><Conversion dataset={dataset}/></div><div className="grid min-w-0 gap-4 xl:grid-cols-2"><Outlets dataset={dataset}/><Trend dataset={dataset} cash/></div></div>;}
