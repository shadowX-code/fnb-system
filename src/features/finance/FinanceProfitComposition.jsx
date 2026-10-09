import { Fragment, useId, useState } from 'react';
import AdminAnalyticalSurface from '../../components/layout/AdminAnalyticalSurface.jsx';
import { FinanceChart, FinanceMark, FinanceChartTip, financeConversionColors, useFinanceGeometry } from './FinanceChart.jsx';
import { FinanceReadiness, FinanceDisclosure, FinanceProvenance } from './FinanceVisualSystem.jsx';
import { financialValue, financialPeriod } from './presentation.js';
import { metricRegistry } from './metrics.js';
import { profitConversion } from './overviewDashboard.js';

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
export default function FinanceProfitComposition({dataset, embedded = false, selectedId, onSelect, children}) {
  const clipId=useId(), projection={...profitConversion(dataset),clipId},[localSelected,setLocalSelected]=useState(null);
  const selected = onSelect ? selectedId : localSelected, setSelected = onSelect ?? setLocalSelected;
  const Surface = embedded ? Fragment : AdminAnalyticalSurface;
  return <Surface {...(embedded ? {} : {label:"Profit Conversion", subtitle:`Where each ringgit of Revenue goes · ${financialPeriod(dataset.period)}.`})}>
    <FinanceChart label="100 percent Revenue composition" height={86} dataKey={`${dataset.period.start}:${dataset.scope.id}`}>
      {width=><ConversionCanvas width={width} projection={projection} selected={selected} onSelect={setSelected}/>}
    </FinanceChart>
    <ul className="divide-y divide-border">{projection.rows.map(row=><li key={row.id}><button type="button" className="flex min-h-11 w-full items-center gap-2 py-2 text-left type-body-sm focus-visible:outline-primary" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)}><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{background:financeConversionColors[row.id]}}/><span className="flex-1">{metricRegistry[row.id].label}</span><strong>{row.share===null?'—':`${row.share.toFixed(1)}%`}</strong><span className="ml-3 text-text-secondary tabular-nums">{financialValue(row.metric)}</span></button></li>)}</ul>
    {!projection.complete?<FinanceReadiness title="Partial composition evidence">A 100% split needs complete, separate COGS, Labour, OPEX and EBITDA that reconcile to Revenue. Supplied amounts keep their own basis.</FinanceReadiness>:<p className="mt-2 type-caption text-text-secondary">Complete, compatible inputs reconcile to 100% of Revenue.</p>}
    {selected && !onSelect?<FinanceDisclosure label={`${metricRegistry[selected].label} definition & evidence`} open><p>{metricRegistry[selected].definition}</p><FinanceProvenance metric={dataset.metrics[selected]}/></FinanceDisclosure>:null}
  {children}</Surface>;
}
