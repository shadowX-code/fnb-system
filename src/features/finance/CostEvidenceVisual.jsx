import { FinanceChart, FinanceMark, FinanceChartTip, useFinanceGeometry, financeMetricColor, financeChartMoney } from './FinanceChart.jsx';
import { metricRegistry } from './metrics.js';
import { financialValue, financialPeriod } from './presentation.js';

function Canvas({ width, rows, trend, selectedId, onSelect }) {
  // Display geometry only; all amounts and Revenue shares are supplied diagnostics.
  const left = width < 440 ? 96 : 142, right = width - 16;
  const bound = Math.max(1, ...rows.flatMap(row => trend ? [Math.abs(row.current.value ?? 0), Math.abs(row.previous.value ?? 0)] : [Math.abs(row.currentRatio.value ?? 0)]));
  const geometry = useFinanceGeometry(Object.fromEntries(rows.map((row,index) => [row.id, [left + (right-left) * Math.abs((trend ? row.previous.value : row.currentRatio.value) ?? 0) / bound, left + (right-left) * Math.abs(row.current.value ?? 0) / bound, 42 + index*72]])));
  return <><text x={left} y="14">{trend?'Amount · RM':'Share of Revenue · %'}</text><text x={right} y="14" textAnchor="end">{trend?financeChartMoney(bound):`${bound.toFixed(1)}%`}</text>{rows.map(row => { const [x,end,y] = geometry[row.id], label = row.label ?? metricRegistry[row.id].label; const ready = trend ? row.current.value !== null && row.previous.value !== null && row.current.value >= 0 && row.previous.value >= 0 : row.currentRatio.value !== null && row.currentRatio.value >= 0;
    return <FinanceMark key={row.id} label={`Investigate ${label} ${trend ? 'trend' : 'structure'}`} selected={selectedId === row.id} dimmed={Boolean(selectedId) && selectedId !== row.id} onSelect={() => onSelect(row.id)} tooltip={<FinanceChartTip title={label} rows={[{label:'Comparison',value:financialValue(row.previous)},{label:'Current',value:financialValue(row.current),color:financeMetricColor(row.id)},{label:'Revenue share',value:financialValue(row.currentRatio)}]}/>}>
      <rect x="0" y={y-22} width={width} height="64" fill="transparent"/><text x="0" y={y} className="chart-label" style={{fontSize:11}}>{label.length>(width<440?13:21)?`${label.slice(0,width<440?11:19)}…`:label}</text><path d={`M${left} ${y}H${right}`} className="chart-grid"/>
      {ready ? trend ? <><path d={`M${x} ${y}H${end}`} className="chart-axis"/><circle cx={x} cy={y} r="5" style={{fill:'none',stroke:'var(--finance-muted)',strokeWidth:1.5}}/><circle cx={end} cy={y} r="7" className="chart-point" fill={financeMetricColor(row.id)}/></> : <rect x={left} y={y-7} width={Math.max(1,x-left)} height="14" rx="3" fill={financeMetricColor(row.id)}/> : <rect x={left} y={y-7} width={right-left} height="14" className="chart-pending"/>}
      <text x={left} y={y+22}>{trend ? `Comparison ${financialValue(row.previous)}` : financialValue(row.current)}</text><text x={left} y={y+38}>{trend ? `Current ${financialValue(row.current)}` : `${financialValue(row.currentRatio)} of Revenue`}</text>
    </FinanceMark>;
  })}</>;
}
export default function CostEvidenceVisual({ rows, view, selectedId, onSelect, pair }) {
  return <><p className="finance-analysis-muted">{view === 'Trend' ? `${financialPeriod(pair.previous.period)} → ${financialPeriod(pair.current.period)} · outlined comparison / filled current` : 'Cost layers against Revenue · Prime Cost overlaps COGS and Labour and is not added again.'}</p><FinanceChart label={`Cost ${view.toLowerCase()} evidence`} height={rows.length*72+44} dataKey={JSON.stringify(rows)}>{width => <Canvas width={width} rows={rows} trend={view === 'Trend'} selectedId={selectedId} onSelect={onSelect}/>}</FinanceChart></>;
}
