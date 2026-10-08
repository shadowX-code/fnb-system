import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import { financeDashboardSummaryItems } from './summaryItems.js';
import FinanceAnalysisSurface from './FinanceAnalysisSurface.jsx';
import { DriverContribution } from './FinanceAnalyticalVisuals.jsx';
import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { FinanceReadiness, FinanceMissing } from './FinanceVisualSystem.jsx';
import { useState } from 'react';
import FinanceComparisonWorkspace from './FinanceComparisonWorkspace.jsx';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import { metricRegistry } from './metrics.js';
import { performanceIds, profitMovement } from './analysis.js';
import { financialPeriod, financialValue } from './presentation.js';
import AnalysisContext from './AnalysisContext.jsx';
import FinanceProfitability from './FinanceProfitability.jsx';
import OutletPerformanceField from './OutletPerformanceField.jsx';
import './finance.css';
import './analysis.css';

function PerformanceStrip({ pair, history, selectedId, onSelect }) {
  return <><AdminSummaryGrid variant="compact" ariaLabel="Financial performance" items={financeDashboardSummaryItems(pair, ['ebitda', 'ebitda_margin', ...performanceIds.filter(id => !['ebitda','ebitda_margin'].includes(id))], { history, primary: ['ebitda'], selectedId, onSelect, comparisonLabel: financialPeriod(pair.previous.period), supporting: {ebitda:`${financialValue(pair.current.metrics.ebitda_margin)} EBITDA margin`} })} /><FinanceMissing ids={performanceIds} metrics={pair.current.metrics} registry={metricRegistry} /></>;
}
function ProfitDriverExplorer({ pair, model, selectedMetric, selectedStage, onSelect }) {
  const movement = profitMovement(pair, model);
  return <section data-workspace-surface="analysis" className="finance-driver-explorer" aria-labelledby="finance-driver-title">
    <p id="finance-driver-title" className="type-body-sm text-text-secondary">Follow EBITDA movement into the evidence behind it. {financialPeriod(pair.previous.period)} → {financialPeriod(pair.current.period)}</p>
    <DriverContribution pair={pair} movement={movement} selectedId={selectedMetric} selectedStage={selectedStage} onSelect={onSelect} />
    {movement.total.value === null && movement.rows.every(row=>row.contribution === null) ? <FinanceReadiness title="Profit movement not ready">Comparable EBITDA and validated driver evidence are required to position contributions.</FinanceReadiness> : null}
    <FinanceDisclosure label="Driver methodology & evidence"><p>{movement.label}. {movement.reason || 'Contributions tie to EBITDA movement in both periods. This explains arithmetic movement, not business causation.'}</p></FinanceDisclosure>
  </section>;
}
function OutletAnalysis({ analysis }) {
  const [outletId, setOutletId] = useState(null);
  const [metricId, setMetricId] = useState('ebitda');
  const [action, setAction] = useState('Explain');
  const outlet = analysis.outlets.find(entry => entry.id === outletId && entry.pair);
  return <FinanceAnalysisSurface label="Outlet Performance" subtitle="Revenue growth × EBITDA margin">
    <OutletPerformanceField embedded outlets={analysis.outlets} selectedId={outlet?.id ?? null} lag={analysis.lag} onSelect={setOutletId}/>
    {outlet ? <section aria-label="Selected outlet performance">
      <p className="type-caption text-text-secondary">Revenue Growth {outlet.position?.x == null ? '—' : `${outlet.position.x.toFixed(1)}%`}</p>
      <AnalysisContext pair={outlet.pair} metricId={metricId} outletLabel={outlet.name} action={action} onAction={setAction} outlets={analysis.outlets} onOutlet={setOutletId} onMetric={setMetricId}/>
    </section> : null}
  </FinanceAnalysisSurface>;
}
export function FinanceAnalysis({ analysis }) {
  const [hasSelection, setHasSelection] = useState(false);
  const [selection, setSelection] = useState({ metricId: 'ebitda', outletId: null, origin: 'driver' });
  const [action, setAction] = useState('Explain');
  const outlet = analysis.outlets.find(entry => entry.id === selection.outletId && entry.pair);
  const pair = outlet?.pair ?? analysis;
  const selectMetric = (metricId, origin = 'driver') => { setHasSelection(true); if (origin === 'previous') setAction('Compare'); setSelection(value => ({ ...value, metricId, origin })); };
  return <div className="finance-analysis-body grid min-w-0 gap-6">
    {analysis.current.demo ? <p className="finance-demo" role="status">Development demo · All figures are illustrative. No business records are used.</p> : null}
    <div>
      <PerformanceStrip pair={analysis} history={analysis.history} selectedId={hasSelection && !outlet ? selection.metricId : null} onSelect={id => {setSelection({metricId:id,outletId:null,origin:'performance'});setHasSelection(true);}}/>

    </div>
    <FinanceAnalysisSurface label="Profit Drivers" subtitle={outlet ? `${outlet.name} · EBITDA movement` : 'EBITDA Movement Bridge'} actions={outlet ? <button type="button" className="btn-secondary" onClick={() => setSelection({metricId:'ebitda',outletId:null,origin:'driver'})}><RotateCcw size={14}/>Return to scope</button> : null}>
      <ProfitDriverExplorer pair={pair} model={analysis.profitDriverModel} selectedMetric={hasSelection ? selection.metricId : null} selectedStage={selection.origin} onSelect={selectMetric}/>
      {hasSelection ? <section aria-label="Selected scope performance"><AnalysisContext pair={pair} metricId={selection.metricId} outletLabel={outlet?.name} action={action} onAction={setAction} outlets={analysis.outlets} onOutlet={id => {setHasSelection(true);setSelection(value => ({...value,outletId:id,origin:'outlet'}));}} onMetric={id => selectMetric(id,selection.origin)}/></section> : null}
      <FinanceDisclosure label="Performance source & completeness"><p>{analysis.current.sourceLabel} · {analysis.current.demo ? 'illustrative evidence' : 'live authorized evidence'}. Monthly evidence is not a closed accounting period. Missing Gross Margin or Prime Cost requires validated accounting COGS and labour evidence.</p><p>Source freshness remains unverified when evidence timestamps are unavailable. Read time is not source freshness. Analytical EBITDA Margin is derived only from complete EBITDA and positive Revenue; the underlying EBITDA definition is retained.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button></FinanceDisclosure>
    </FinanceAnalysisSurface>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
      <OutletAnalysis analysis={analysis}/>
      <FinanceProfitability analysis={analysis}/>
    </div>
  </div>;
}
export default function FinanceAnalysisPage(props) {
  return <FinanceComparisonWorkspace {...props} title="Analysis" description="Understand what changed, what drove it, and where to investigate next." includeOutlets>{analysis => <FinanceAnalysis analysis={analysis} />}</FinanceComparisonWorkspace>;
}
