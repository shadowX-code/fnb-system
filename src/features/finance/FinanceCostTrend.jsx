import { useState } from 'react';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import { FinanceChart, financeChartColors } from './FinanceChart.jsx';
import { FinanceMonthlyTrendCanvas, FinanceHistoryEvidence } from './FinanceMonthlyTrend.jsx';
import { overviewHistory } from './overviewDashboard.js';
import { analysisPair, shiftMonth } from './analysis.js';
import { FinanceReadiness } from './FinanceVisualSystem.jsx';
import { metricRegistry } from './metrics.js';
import FinanceAnalysisSurface from './FinanceAnalysisSurface.jsx';
import AnalysisContext from './AnalysisContext.jsx';

const ids = ['cogs', 'labour', 'opex'];
/** Monthly observations retain their validated metric basis; Prime Cost is not added again. */
export default function FinanceCostTrend({ analysis }) {
  const [range, setRange] = useState('6M');
  const [selected, setSelected] = useState(null);
  const [metricId, setMetricId] = useState('cogs');
  const [action, setAction] = useState('Explain');
  const rows = overviewHistory({ ...analysis.current, history: analysis.history }, range === '6M' ? 6 : 12, ids);
  const row = rows.find(entry => entry.period.start === selected);
  const previous = row && analysis.history?.find(entry => entry.period.start === shiftMonth(row.period, -1).start);
  const pair = row?.dataset && previous?.dataset ? analysisPair(row.dataset, previous.dataset) : null;
  const known = rows.filter(entry => ids.every(id => entry[id] !== null)).length;
  return <FinanceAnalysisSurface label="Cost Trend" subtitle="Monthly cost development · RM · selected scope" actions={<AdminSegmentedControl label="Cost history" value={range} onChange={value => { setRange(value); if (value === '6M' && !rows.slice(-6).some(entry => entry.period.start === selected)) setSelected(null); }} options={['6M', '12M'].map(value => ({ value, label: value }))} />}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 type-caption text-text-secondary">{ids.map(id => <span key={id} className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: financeChartColors[id] }} />{metricRegistry[id].label}</span>)}</div>
    <FinanceChart label="Monthly cost history" height={344} dataKey={`${analysis.current.period.start}:${analysis.current.scope.id}:${range}`}>{width => <FinanceMonthlyTrendCanvas width={width} height={344} rows={rows} ids={ids} selected={selected} onSelect={period => { setSelected(period); setMetricId('cogs'); setAction('Explain'); }} />}</FinanceChart>
    {known < rows.length || !rows.length ? <FinanceReadiness title={known ? 'Partial monthly cost evidence' : 'Monthly cost evidence not ready'}>Only complete monthly costs on compatible evidence bases are plotted. Missing months remain gaps.</FinanceReadiness> : null}
    {pair ? <AnalysisContext pair={pair} metricId={metricId} action={action} onAction={setAction} onMetric={setMetricId} /> : row ? <FinanceReadiness title="Monthly comparison not ready">A validated preceding-month dataset is required for comparison.</FinanceReadiness> : null}
    <FinanceHistoryEvidence rows={rows} ids={ids} />
  </FinanceAnalysisSurface>;
}
