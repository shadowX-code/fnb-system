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

function PerformanceStrip({ pair, onSelect }) {
  return <><dl className="finance-performance-strip" aria-label="Financial performance">{performanceIds.filter((id) => pair.current.metrics[id].value !== null).map((id) => {
    const metric = pair.current.metrics[id], movement = metricMovement(metric, pair.previous.metrics[id]);
    return <div key={id}><dt><button type="button" onClick={() => onSelect(id)}>{metricRegistry[id].label}</button></dt><dd><strong>{financialValue(metric)}</strong><span>{movementValue(movement, metric.unit)}</span><small>{financialSemantics(metric)} · {metric.completeness}</small></dd></div>;
  })}</dl><FinanceMissing ids={performanceIds} metrics={pair.current.metrics} registry={metricRegistry} /></>;
}
function ProfitDriverExplorer({ pair, model, selectedMetric, onSelect }) {
  const movement = profitMovement(pair, model);
  return <section className="finance-driver-explorer" aria-labelledby="finance-driver-title">
    <div className="finance-analysis-heading"><div><h2 id="finance-driver-title">Profit Driver Explorer</h2><p>Follow EBITDA movement into the evidence behind it.</p></div><span className="finance-analysis-muted">{financialPeriod(pair.previous.period)} → {financialPeriod(pair.current.period)}</span></div>
    {movement.total.value === null && movement.rows.every((row) => row.contribution === null) ? <FinanceReadiness title="Profit movement not ready">Comparable EBITDA and validated driver evidence are required. Current financial values remain available above.</FinanceReadiness> : <div className="finance-driver-model">
      <button type="button" className={`finance-driver-root ${selectedMetric === 'ebitda' ? 'is-selected' : ''}`} aria-pressed={selectedMetric === 'ebitda'} onClick={() => onSelect('ebitda')}><span>EBITDA movement</span><strong>{movementValue(movement.total)}</strong><small>{financialValue(pair.previous.metrics.ebitda)} → {financialValue(pair.current.metrics.ebitda)}</small></button>
      <div className="finance-driver-branches">{movement.rows.map((row) => <button key={row.id} type="button" className={`finance-driver-node ${selectedMetric === row.id ? 'is-selected' : ''} ${row.contribution === null ? 'is-unresolved' : ''}`} aria-pressed={selectedMetric === row.id} aria-label={`Explore ${metricRegistry[row.id].label} driver`} onClick={() => onSelect(row.id)}>
        <span><strong>{metricRegistry[row.id].label}</strong><small>{financialValue(pair.previous.metrics[row.id])} → {financialValue(pair.current.metrics[row.id])}</small></span>
        <span className="finance-driver-effect"><strong>{movementValue({ value: row.contribution })}</strong><small>{!row.included ? 'Not separately included in this EBITDA basis' : row.contribution === null ? 'Contribution not validated' : row.contribution > 0 ? 'Supports EBITDA' : row.contribution < 0 ? 'Reduces EBITDA' : 'No movement'}</small></span>
      </button>)}</div>
    </div>}
    <p className="finance-analysis-muted">{movement.label}. {movement.reason || 'Contributions tie to EBITDA movement in both periods. This explains arithmetic movement, not business causation.'}</p>
  </section>;
}
export function FinanceAnalysis({ analysis }) {
  const [selection, setSelection] = useState({ metricId: 'ebitda', outletId: null, origin: 'driver' });
  const [action, setAction] = useState('Explain');
  const outlet = analysis.outlets.find((entry) => entry.id === selection.outletId);
  const pair = outlet?.pair ?? analysis;
  const selectMetric = (metricId, origin = 'driver') => { setSelection((value) => ({ ...value, metricId, origin })); };
  const context = <AnalysisContext pair={pair} metricId={selection.metricId} outletLabel={outlet?.name} action={action} onAction={setAction} outlets={analysis.outlets} onOutlet={(id) => setSelection((value) => ({ ...value, outletId: id, origin: 'outlet' }))} onMetric={(id) => selectMetric(id, selection.origin)} />;
  const total = metricMovement(pair.current.metrics.ebitda, pair.previous.metrics.ebitda);
  return <div className="finance-analysis-body">
    {analysis.current.demo ? <p className="finance-demo" role="status">Development demo · All figures are illustrative. No business records are used.</p> : null}
    <div className="finance-analysis-state">
      <div className="finance-analysis-heading"><div><p className="finance-analysis-muted">{financialPeriod(pair.current.period)} compared with {financialPeriod(pair.previous.period)}</p><h2>{outlet ? outlet.name : 'Business performance'}</h2></div>{outlet ? <button type="button" className="btn-secondary" onClick={() => setSelection({ metricId: 'ebitda', outletId: null, origin: 'driver' })}><RotateCcw size={14} />Return to scope</button> : null}</div>
      <p className="finance-analysis-summary">{total.value === null ? 'EBITDA movement is unavailable for this comparison.' : total.value === 0 ? 'EBITDA is unchanged between these periods.' : `EBITDA ${total.value > 0 ? 'increased' : 'decreased'} by ${financialValue({ value: Math.abs(total.value), unit: 'money' })}.`}</p>
      <PerformanceStrip pair={pair} onSelect={(id) => selectMetric(id, 'performance')} />
      <FinanceDisclosure label="Performance source & completeness"><p>{pair.current.sourceLabel} · {analysis.current.demo ? 'illustrative evidence' : 'live authorized evidence'}. Monthly evidence is not a closed accounting period. Missing Gross Margin or Prime Cost requires validated accounting COGS and labour evidence.</p><p>Source freshness remains unverified when evidence timestamps are unavailable. Read time is not source freshness. Analytical EBITDA Margin is derived only from complete EBITDA and positive Revenue; the underlying EBITDA definition is retained.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button></FinanceDisclosure>
    </div>
    {selection.origin === 'performance' ? context : null}
    <ProfitDriverExplorer pair={pair} model={analysis.profitDriverModel} selectedMetric={selection.metricId} onSelect={selectMetric} />
    {selection.origin === 'driver' ? context : null}
    <OutletPerformanceField outlets={analysis.outlets} selectedId={selection.outletId} lag={analysis.lag} onSelect={(id) => { setSelection((value) => ({ ...value, outletId: id, origin: 'outlet' })); }} />
    {selection.origin === 'outlet' ? <section className="finance-selected-outlet" aria-label="Selected outlet performance"><div className="finance-analysis-heading"><h2>{outlet?.name} · outlet detail</h2><span className="finance-analysis-muted">Revenue Growth {outlet?.position?.x === null || outlet?.position?.x === undefined ? 'unavailable' : `${outlet.position.x.toFixed(1)}%`}</span></div><PerformanceStrip pair={pair} onSelect={(id) => selectMetric(id, 'outlet')} />{context}</section> : null}
  </div>;
}
export default function FinanceAnalysisPage(props) {
  return <FinanceComparisonWorkspace {...props} title="Analysis" description="Understand what changed, what drove it, and where to investigate next." includeOutlets>{(analysis) => <FinanceAnalysis analysis={analysis} />}</FinanceComparisonWorkspace>;
}
