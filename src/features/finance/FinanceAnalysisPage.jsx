import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { getAccessibleOutlets } from '../../utils/accessControl.js';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import { financeDemoEnabled, getFinanceProvider } from './financeService.js';
import { monthlyPeriod, previousPeriod } from './foundation.js';
import { metricMovement, metricRegistry } from './metrics.js';
import { performanceIds, profitMovement, readFinanceAnalysis, shiftMonth } from './analysis.js';
import { currentFinanceMonth, financialPeriod, financialSemantics, financialValue, movementValue } from './presentation.js';
import AnalysisContext from './AnalysisContext.jsx';
import OutletPerformanceField from './OutletPerformanceField.jsx';
import './finance.css';
import './analysis.css';

function PerformanceStrip({ pair, onSelect }) {
  return <dl className="finance-performance-strip" aria-label="Financial performance">{performanceIds.map((id) => {
    const metric = pair.current.metrics[id], movement = metricMovement(metric, pair.previous.metrics[id]);
    return <div key={id}><dt><button type="button" onClick={() => onSelect(id)}>{metricRegistry[id].label}</button></dt><dd><strong>{financialValue(metric)}</strong><span>{movementValue(movement, metric.unit)}</span><small>{financialSemantics(metric)} · {metric.completeness}</small></dd></div>;
  })}</dl>;
}
function ProfitDriverExplorer({ pair, model, selectedMetric, onSelect }) {
  const movement = profitMovement(pair, model);
  return <section className="finance-driver-explorer" aria-labelledby="finance-driver-title">
    <div className="finance-analysis-heading"><div><h2 id="finance-driver-title">Profit Driver Explorer</h2><p>Follow EBITDA movement into the evidence behind it.</p></div><span className="finance-analysis-muted">{financialPeriod(pair.previous.period)} → {financialPeriod(pair.current.period)}</span></div>
    <div className="finance-driver-model">
      <button type="button" className={`finance-driver-root ${selectedMetric === 'ebitda' ? 'is-selected' : ''}`} aria-pressed={selectedMetric === 'ebitda'} onClick={() => onSelect('ebitda')}><span>EBITDA movement</span><strong>{movementValue(movement.total)}</strong><small>{financialValue(pair.previous.metrics.ebitda)} → {financialValue(pair.current.metrics.ebitda)}</small></button>
      <div className="finance-driver-branches">{movement.rows.map((row) => <button key={row.id} type="button" className={`finance-driver-node ${selectedMetric === row.id ? 'is-selected' : ''} ${row.contribution === null ? 'is-unresolved' : ''}`} aria-pressed={selectedMetric === row.id} aria-label={`Explore ${metricRegistry[row.id].label} driver`} onClick={() => onSelect(row.id)}>
        <span><strong>{metricRegistry[row.id].label}</strong><small>{financialValue(pair.previous.metrics[row.id])} → {financialValue(pair.current.metrics[row.id])}</small></span>
        <span className="finance-driver-effect"><strong>{movementValue({ value: row.contribution })}</strong><small>{!row.included ? 'Not separately included in this EBITDA basis' : row.contribution === null ? 'Contribution not validated' : row.contribution > 0 ? 'Supports EBITDA' : row.contribution < 0 ? 'Reduces EBITDA' : 'No movement'}</small></span>
      </button>)}</div>
    </div>
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
      <details className="finance-analysis-evidence"><summary>Performance source & completeness</summary><p>{pair.current.sourceLabel} · {analysis.current.demo ? 'illustrative evidence' : 'live authorized evidence'}. Monthly evidence is not a closed accounting period. Missing Gross Margin or Prime Cost requires validated accounting COGS and labour evidence.</p><p>Source freshness remains unverified when evidence timestamps are unavailable. Read time is not source freshness. Analytical EBITDA Margin is derived only from complete EBITDA and positive Revenue; the underlying EBITDA definition is retained.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Review Data Sources <ArrowRight size={14} /></button></details>
    </div>
    {selection.origin === 'performance' ? context : null}
    <ProfitDriverExplorer pair={pair} model={analysis.profitDriverModel} selectedMetric={selection.metricId} onSelect={selectMetric} />
    {selection.origin === 'driver' ? context : null}
    <OutletPerformanceField outlets={analysis.outlets} selectedId={selection.outletId} lag={analysis.lag} onSelect={(id) => { setSelection((value) => ({ ...value, outletId: id, origin: 'outlet' })); }} />
    {selection.origin === 'outlet' ? <section className="finance-selected-outlet" aria-label="Selected outlet performance"><div className="finance-analysis-heading"><h2>{outlet?.name} · outlet detail</h2><span className="finance-analysis-muted">Revenue Growth {outlet?.position?.x === null || outlet?.position?.x === undefined ? 'unavailable' : `${outlet.position.x.toFixed(1)}%`}</span></div><PerformanceStrip pair={pair} onSelect={(id) => selectMetric(id, 'outlet')} />{context}</section> : null}
  </div>;
}
export default function FinanceAnalysisPage({ store = {}, auth }) {
  const [mode, setMode] = useState('operational');
  const [month, setMonth] = useState(currentFinanceMonth);
  const [comparisonMode, setComparisonMode] = useState('previous');
  const [customMonth, setCustomMonth] = useState(() => previousPeriod(monthlyPeriod(currentFinanceMonth())).start.slice(0, 7));
  const [outletId, setOutletId] = useState('all');
  const [demoScope, setDemoScope] = useState('group:demo-group');
  const [demoScopes, setDemoScopes] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Auth/store wrappers can rerender when shared controls open. Only changed authorized identities
  // or labels invalidate this read; equal scope must preserve the user's analytical selection.
  const outletSignature = JSON.stringify(getAccessibleOutlets(auth, store.outlets ?? []).map((outlet) => ({ id: outlet.id, name: outlet.name })));
  const outlets = useMemo(() => JSON.parse(outletSignature), [outletSignature]);
  const comparisonMonth = comparisonMode === 'custom' ? customMonth : shiftMonth(monthlyPeriod(month), comparisonMode === 'year' ? -12 : -1).start.slice(0, 7);
  useEffect(() => {
    if (!financeDemoEnabled || mode !== 'demo') return;
    let active = true;
    import('./providers/fixtureProvider.js').then(({ fixtureScopes }) => { if (active) setDemoScopes(fixtureScopes); }).catch(() => { if (active) { setError('Development evidence could not be loaded.'); setLoading(false); } });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setAnalysis(null);
    const scope = mode === 'demo' ? demoScopes.find((entry) => entry.value === demoScope) : outletId === 'all' ? { kind: 'authorized_outlets', id: null } : outlets.some((outlet) => outlet.id === outletId) ? { kind: 'outlet', id: outletId } : null;
    if (!scope) { if (mode !== 'demo' || demoScopes.length) { setError('Choose an available financial scope.'); setLoading(false); } return () => controller.abort(); }
    const request = { scope: { kind: scope.kind, id: scope.id, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) }, period: monthlyPeriod(month), currency: 'MYR' };
    const eligible = mode === 'demo' ? demoScopes.filter((entry) => entry.kind === 'outlet').map((entry) => ({ id: entry.id, name: entry.label, legalEntityId: entry.legalEntityId })) : outlets;
    getFinanceProvider(mode).then((provider) => readFinanceAnalysis(provider, request, { comparisonPeriod: monthlyPeriod(comparisonMonth), outlets: eligible, allowDemo: financeDemoEnabled && mode === 'demo', signal: controller.signal })).then((result) => { if (!controller.signal.aborted) setAnalysis(result); }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message === 'Choose a complete comparison month before the current period.' ? failure.message : 'Analysis evidence could not be loaded. Retry the read or review Data Sources.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, month, comparisonMonth, outletId, demoScope, demoScopes, outlets, attempt]);
  return <div className="finance-workspace finance-analysis-page space-y-5">
    <PageHeader section="Finance" title="Analysis" description="Understand what changed, what drove it, and where to investigate next." />
    <AdminFilterToolbar>
      {financeDemoEnabled ? <SelectField label="Evidence" value={mode} onChange={setMode} options={[{ value: 'operational', label: 'FeedX operational' }, { value: 'demo', label: 'Development demo' }]} /> : null}
      <SelectField label={mode === 'demo' ? 'Demo scope' : 'Outlet scope'} value={mode === 'demo' ? demoScope : outletId} onChange={mode === 'demo' ? setDemoScope : setOutletId} options={mode === 'demo' ? demoScopes : [{ value: 'all', label: 'All authorized outlets' }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} />
      <MonthPickerField label="Current period" value={month} onChange={setMonth} />
      <SelectField label="Compare with" value={comparisonMode} onChange={setComparisonMode} options={[{ value: 'previous', label: 'Previous month' }, { value: 'year', label: 'Same month last year' }, { value: 'custom', label: 'Selected month' }]} />
      {comparisonMode === 'custom' ? <MonthPickerField label="Comparison period" value={customMonth} onChange={setCustomMonth} /> : null}
    </AdminFilterToolbar>
    <AsyncDataSurface loading={loading} error={error} hasData={Boolean(analysis)} loadingRows={6} onRetry={() => setAttempt((value) => value + 1)}>{analysis ? <FinanceAnalysis key={`${mode}:${month}:${comparisonMonth}:${outletId}:${demoScope}`} analysis={analysis} /> : null}</AsyncDataSurface>
  </div>;
}
