import {AdminChart,AdminChartMark,AdminChartTooltipContent,adminChartColors,adminChartLinePath,adminChartScale} from '../../components/ui/AdminChart.jsx';
import {adsMetric,adsDailySpend} from './adsPresentation.js';
const dateLabel = date => new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
export default function AdsPerformanceTrend({report}) {
  const data=adsDailySpend(report), available=data.filter(r=>r.spend!==null);
  return <figure className="ads-spend-chart">
    <figcaption className="ads-section-heading"><h3>Daily spend</h3><span>{report?.account?.currency || 'Currency unavailable'} · {report?.account?.timezone || 'Timezone unavailable'}</span></figcaption>
    {!available.length?<p className="ads-chart-empty">Daily spend unavailable for this scope and period. Brand totals do not imply daily attribution.</p>:<AdminChart label="Daily advertising spend" height={218} dataKey={data}>{width=>{
      const left=44,right=14,top=16,bottom=180,scale=adminChartScale(available.map(r=>r.spend)),x=i=>left+i/Math.max(1,data.length-1)*(width-left-right),y=v=>bottom-(v-scale.min)/(scale.max-scale.min)*(bottom-top),ticks=[...new Set([0,Math.floor((data.length-1)/2),data.length-1])];
      return <><g aria-hidden="true">{scale.ticks.map(value=><g key={value}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="chart-grid"/><text x={left-8} y={y(value)+4} textAnchor="end" fill="var(--color-text-secondary)">{new Intl.NumberFormat('en-MY',{notation:'compact',maximumFractionDigits:1}).format(value)}</text></g>)}{ticks.map(i=><text key={i} x={x(i)} y="208" textAnchor={i===0?'start':i===data.length-1?'end':'middle'} fill="var(--color-text-secondary)">{dateLabel(data[i].date)}</text>)}</g>
      <path d={adminChartLinePath(data.map((r,i)=>r.spend===null?null:[x(i),y(r.spend)]))} stroke={adminChartColors.emerald} strokeWidth="2" fill="none" className="admin-chart-series"/>
      {data.map((r,i)=>r.spend===null?null:<AdminChartMark key={r.date} label={`${dateLabel(r.date)}: ${adsMetric({value:r.spend},'spend',report.account.currency)}`} onSelect={()=>{}} tooltipAnchor={{x:x(i),y:top+30}} tooltip={<AdminChartTooltipContent title={dateLabel(r.date)} rows={[{label:'Spend',value:adsMetric({value:r.spend},'spend',report.account.currency),color:adminChartColors.emerald}]} note={`Reporting timezone: ${report.account.timezone}`}/>}><rect x={x(i)-6} y={top} width="12" height={bottom-top} fill="transparent"/><circle cx={x(i)} cy={y(r.spend)} r={available.length===1?4:2} fill={adminChartColors.emerald}/><rect x={x(i)-6} y={top} width="12" height={bottom-top} className="chart-focus"/></AdminChartMark>)}</>;
    }}</AdminChart>}
    {available.length>0 && <details className="ads-advanced"><summary>Daily values · missing dates remain unavailable</summary><dl className="ads-daily-values">{data.map(r=><div key={r.date}><dt>{dateLabel(r.date)}</dt><dd>{adsMetric({value:r.spend},'spend',report.account.currency)}</dd></div>)}</dl></details>}
  </figure>;
}
