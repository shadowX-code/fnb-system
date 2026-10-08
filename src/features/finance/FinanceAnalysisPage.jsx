import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import { financeSummaryItems } from './summaryItems.js';
import FinanceAnalysisSurface from './FinanceAnalysisSurface.jsx';
import { DriverContribution } from './FinanceAnalyticalVisuals.jsx';
import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { FinanceReadiness, FinanceMissing } from './FinanceVisualSystem.jsx';
import { useState } from 'react';
import FinanceComparisonWorkspace from './FinanceComparisonWorkspace.jsx';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import { metricMovement, metricRegistry } from './metrics.js';
import { performanceIds, profitMovement } from './analysis.js';
import { financialPeriod, financialSemantics, financialValue, movementValue } from './presentation.js';
import AnalysisContext from './AnalysisContext.jsx';
import OutletPerformanceField from './OutletPerformanceField.jsx';
import './finance.css';
import './analysis.css';

function PerformanceStrip({ pair, selectedId, onSelect }) {
  return <><AdminSummaryGrid variant="compact" ariaLabel="Financial performance" items={financeSummaryItems(pair, ['ebitda', 'ebitda_margin', ...performanceIds.filter(id => !['ebitda','ebitda_margin'].includes(id))], { primary: ['ebitda'], selectedId, onSelect })} /><FinanceMissing ids={performanceIds} metrics={pair.current.metrics} registry={metricRegistry} /></>;
}
function ProfitDriverExplorer({ pair, model, selectedMetric, selectedStage, onSelect }) {
  const movement = profitMovement(pair, model);
  return <section data-workspace-surface="analysis" className="finance-driver-explorer" aria-labelledby="finance-driver-title">
    <p id="finance-driver-title" className="type-body-sm text-text-secondary">Follow EBITDA movement into the evidence behind it. {financialPeriod(pair.previous.period)} → {financialPeriod(pair.current.period)}</p>
    <DriverContribution pair={pair} movement={movement} selectedId={selectedMetric} selectedStage={selectedStage} onSelect={onSelect} />
    {movement.total.value === null && movement.rows.every(row=>row.contribution === null) ? <FinanceReadiness title="Profit movement not ready">Comparable EBITDA and validated driver evidence are required to position contributions.</FinanceReadiness> : null}
    <p className="finance-analysis-muted">{movement.label}. {movement.reason || 'Contributions tie to EBITDA movement in both periods. This explains arithmetic movement, not business causation.'}</p>
  </section>;
}
export function FinanceAnalysis({ analysis, initialView = 'Profit Drivers' }) {
  const [view, setView] = useState(initialView);
  const [hasSelection, setHasSelection] = useState(false);
  const [selection, setSelection] = useState({ metricId: 'ebitda', outletId: null, origin: 'driver' });
  const [action, setAction] = useState('Explain');
  const outlet = analysis.outlets.find((entry) => entry.id === selection.outletId && entry.pair);
  const pair = outlet?.pair ?? analysis;
  const selectMetric = (metricId, origin = 'driver') => { setHasSelection(true); if (origin === 'previous') setAction('Compare'); setSelection((value) => ({ ...value, metricId, origin })); };
  const context = <AnalysisContext pair={pair} metricId={selection.metricId} outletLabel={outlet?.name} action={action} onAction={setAction} outlets={analysis.outlets} onOutlet={(id) => { setHasSelection(true); setSelection((value) => ({ ...value, outletId: id, origin: 'outlet' })); }} onMetric={(id) => selectMetric(id, selection.origin)} />;
  const total = metricMovement(pair.current.metrics.ebitda, pair.previous.metrics.ebitda);
  return <div className="finance-analysis-body">
    {analysis.current.demo ? <p className="finance-demo" role="status">Development demo · All figures are illustrative. No business records are used.</p> : null}
    <div className="finance-analysis-state">
      <div className="finance-analysis-heading"><div><p className="finance-analysis-muted">{financialPeriod(pair.current.period)} compared with {financialPeriod(pair.previous.period)}</p><h2>{outlet ? outlet.name : 'Business performance'}</h2></div>{outlet ? <button type="button" className="btn-secondary" onClick={() => setSelection({ metricId: 'ebitda', outletId: null, origin: 'driver' })}><RotateCcw size={14} />Return to scope</button> : null}</div>
      <p className="finance-analysis-summary">{total.value === null ? 'EBITDA movement is unavailable for this comparison.' : total.value === 0 ? 'EBITDA is unchanged between these periods.' : `EBITDA ${total.value > 0 ? 'increased' : 'decreased'} by ${financialValue({ value: Math.abs(total.value), unit: 'money' })}.`}</p>
      <PerformanceStrip pair={pair} selectedId={hasSelection ? selection.metricId : null} onSelect={(id) => selectMetric(id, 'performance')} />
      <FinanceDisclosure label="Performance source & completeness"><p>{pair.current.sourceLabel} · {analysis.current.demo ? 'illustrative evidence' : 'live authorized evidence'}. Monthly evidence is not a closed accounting period. Missing Gross Margin or Prime Cost requires validated accounting COGS and labour evidence.</p><p>Source freshness remains unverified when evidence timestamps are unavailable. Read time is not source freshness. Analytical EBITDA Margin is derived only from complete EBITDA and positive Revenue; the underlying EBITDA definition is retained.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button></FinanceDisclosure>
    </div>
    <FinanceAnalysisSurface label="Analysis view" title={view === 'Profit Drivers' ? 'Driver Contribution' : 'Outlet Performance Field'} modes={['Profit Drivers', 'Outlets']} value={view} onChange={value => { setView(value); setHasSelection(false); }}>
      {view === 'Profit Drivers' ? <ProfitDriverExplorer pair={pair} model={analysis.profitDriverModel} selectedMetric={hasSelection ? selection.metricId : null} selectedStage={selection.origin} onSelect={selectMetric} /> : <OutletPerformanceField embedded outlets={analysis.outlets} selectedId={hasSelection ? outlet?.id ?? null : null} lag={analysis.lag} onSelect={id => { setHasSelection(true); setSelection(value => ({...value,outletId:id,origin:'outlet'})); }} />}
      {hasSelection ? <section aria-label={outlet ? 'Selected outlet performance' : 'Selected scope performance'}>{outlet ? <p className="finance-analysis-muted">Revenue Growth {outlet.position?.x == null ? '—' : `${outlet.position.x.toFixed(1)}%`}</p> : null}{context}</section> : null}
    </FinanceAnalysisSurface>
  </div>;
}
export default function FinanceAnalysisPage(props) {
  return <FinanceComparisonWorkspace {...props} title="Analysis" description="Understand what changed, what drove it, and where to investigate next." includeOutlets>{(analysis, initial) => <FinanceAnalysis initialView={initial?.view} analysis={analysis} />}</FinanceComparisonWorkspace>;
}
