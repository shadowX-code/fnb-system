import { useState } from 'react';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import { FinanceChart, financeChartColors } from './FinanceChart.jsx';
import { FinanceMonthlyTrendCanvas, FinanceHistoryEvidence } from './FinanceMonthlyTrend.jsx';
import { overviewHistory } from './overviewDashboard.js';
import { analysisPair, shiftMonth } from './analysis.js';
import { FinanceReadiness } from './FinanceVisualSystem.jsx';
import { metricMovement } from './metrics.js';
import { financialPeriod, movementValue } from './presentation.js';
import AnalysisContext from './AnalysisContext.jsx';

/** Selected toolbar scope, validated monthly metrics, and the existing margin definition. */
export default function FinanceProfitability({ analysis }) {
  const [range, setRange] = useState('6M');
  const [selected, setSelected] = useState(null);
  const [metricId, setMetricId] = useState('ebitda_margin');
  const [action, setAction] = useState('Explain');
  const rows = overviewHistory({...analysis.current, history:analysis.history}, range === '6M' ? 6 : 12);
  const row = rows.find(entry => entry.period.start === selected);
  const previous = row && analysis.history?.find(entry => entry.period.start === shiftMonth(row.period,-1).start);
  const selectedPair = row?.dataset && previous?.dataset ? analysisPair(row.dataset, previous.dataset) : null;
  const known = rows.filter(entry => entry.ebitda_margin !== null).length;
  const tooltipRows = entry => {
    const preceding = analysis.history?.find(item => item.period.start === shiftMonth(entry.period,-1).start);
    if (!entry.dataset || !preceding?.dataset) return [{label:'Previous month',value:'Evidence not ready'}];
    const pair = analysisPair(entry.dataset, preceding.dataset);
    const movement = metricMovement(pair.current.metrics.ebitda_margin, pair.previous.metrics.ebitda_margin);
    return [{label:`vs ${financialPeriod(preceding.period)}`,value:movementValue(movement,'percent')}];
  };
  const select = period => { setSelected(period); setMetricId('ebitda_margin'); setAction('Explain'); };
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="type-body-sm text-text-secondary">Monthly EBITDA margin · selected scope. Select a month to investigate its preceding-month comparison.</p>
      <AdminSegmentedControl label="Profitability history" value={range} onChange={value => { setRange(value); if (!rows.slice(-6).some(entry => entry.period.start === selected) && value === '6M') setSelected(null); }} options={['6M','12M'].map(value => ({value,label:value}))}/>
    </div>
    <div className="flex items-center gap-2 type-caption text-text-secondary"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{background:financeChartColors.ebitda_margin}}/>EBITDA Margin (%)</div>
    <FinanceChart label="Monthly EBITDA Margin history" height={246} dataKey={`${analysis.current.period.start}:${analysis.current.scope.id}:${range}`}>
      {width => <FinanceMonthlyTrendCanvas width={width} rows={rows} ids={['ebitda_margin']} percent selected={selected} onSelect={select} tooltipRows={tooltipRows}/>}
    </FinanceChart>
    {known < rows.length || !rows.length ? <FinanceReadiness title={known ? 'Partial monthly evidence' : 'Monthly evidence not ready'}>Only complete EBITDA and positive Revenue on compatible evidence bases are plotted. Review Data Sources for history coverage.</FinanceReadiness> : null}
    {selectedPair ? <AnalysisContext pair={selectedPair} metricId={metricId} action={action} onAction={setAction} onMetric={setMetricId}/> : row ? <FinanceReadiness title="Monthly comparison not ready">{financialPeriod(row.period)} has no validated preceding-month dataset. Review Data Sources for comparison coverage.</FinanceReadiness> : null}
    <FinanceHistoryEvidence rows={rows} ids={['ebitda_margin']}/>
  </>;
}
