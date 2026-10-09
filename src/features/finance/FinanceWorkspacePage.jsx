import { FinancePlanningReadiness, FinanceStatements } from './FinanceReadinessPages.jsx';
import FinanceOverviewCharts from './FinanceOverviewCharts.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import { financeDashboardSummaryItems } from './summaryItems.js';
import FinanceAnalysisSurface from './FinanceAnalysisSurface.jsx';
import { profitMovement } from './analysis.js';
import { costIntelligence } from './costs.js';
import FinancePreviewBoundary from './FinancePreviewBoundary.jsx';
import { DriverContribution } from './FinanceAnalyticalVisuals.jsx';
import { FinanceReadiness, FinanceDisclosure, FinanceMissing, FinanceContext, FinanceProvenance } from './FinanceVisualSystem.jsx';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { getAccessibleOutletOptions, getAccessibleOutlets } from '../../utils/accessControl.js';
import { money, periodLabel } from '../reports/components/reportingFormatters.js';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import { financeDemoEnabled, getFinanceProvider, readFinanceOverview } from './financeService.js';
import { financialValue as amount, financialSemantics as semantic, currentFinanceMonth as currentMonth } from './presentation.js';
import { monthlyPeriod } from './foundation.js';
import { overviewDataStatus } from './dataSources.js';
import { metricRegistry } from './metrics.js';
import './finance.css';

const sectionLabels = { overview: 'Overview', analysis: 'Analysis', costs: 'Costs', cash: 'Cash', planning: 'Planning', statements: 'Statements' };
const sectionDescriptions = {
  overview: 'Financial performance at a glance.',
  analysis: 'Understand what is driving growth and profitability.',
  costs: 'Find where margin is being gained or lost.',
  cash: 'Understand liquidity, commitments and working capital.',
  planning: 'Model where the business is heading and what could change it.',
  statements: 'Authoritative financial statements and supporting evidence.',
};
export function FinanceDataStatus({ dataset, loading, error }) {
  const status = dataset ? overviewDataStatus(dataset) : null;
  const freshness = status?.evidenceAt ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(status.evidenceAt)) : 'Unverified · source timestamp unavailable';
  return <section className="finance-data-status" aria-label="Financial data status">
    <FinanceDisclosure label={status ? `${status.sourceLabel} · ${status.completeness} evidence` : loading ? 'Loading source evidence…' : 'Source evidence unavailable'}><dl>
      <div><dt>Source</dt><dd>{status ? status.sourceLabel : loading ? 'Loading source evidence…' : 'Unavailable'}</dd>{status ? <span>{status.demo ? 'Development illustration · ' : ''}{status.semantics.map((semantic) => semantic[0] + semantic.slice(1).toLowerCase()).join(' / ') || 'Unavailable'}</span> : null}</div>
      <div><dt>Source freshness</dt><dd>{status ? freshness : 'Unavailable'}</dd></div>
      <div><dt>Completeness</dt><dd>{status ? status.completeness : error ? 'Unavailable' : 'Not assessed'}</dd>{status ? <span>{status.available} of {status.total} measures available · reconciliation unverified</span> : null}</div>
    </dl></FinanceDisclosure>
    <button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_data_sources')}>Data Sources <ArrowRight size={15} /></button>
  </section>;
}
function Comparison({ metric }) {
  const prior = metric?.comparison;
  if (metric?.value === null || !Number.isFinite(prior?.value)) return <span>Prior period unavailable</span>;
  return <span>Previous month {amount({ ...metric, value: prior.value })}{prior.completeness !== 'complete' ? ' · Partial' : ''}</span>;
}
export function FinanceOverview({ dataset }) {
  const metrics = dataset.metrics;
  const [selectedId, setSelectedId] = useState(null);
  const [selectedStage, setSelectedStage] = useState(null);
  const previous = dataset.comparisonDataset ?? { ...dataset, metrics: Object.fromEntries(Object.entries(metrics).map(([id, metric]) => [id, { ...metric, value: null, completeness: 'unavailable' }])) };
  const pair = { current: dataset, previous, profitDriverModel: dataset.profitDriverModel };
  const movement = profitMovement(pair, dataset.profitDriverModel);
  const attention = costIntelligence(pair).rows.filter(row => row.direction === 'pressure');
  const [action, setAction] = useState('Explain');

  const cards = financeDashboardSummaryItems(pair, ['ebitda', 'revenue', 'gross_margin', 'prime_cost', 'cash'], { primary: ['ebitda'], supporting: { ebitda: `${amount(metrics.ebitda_margin)} EBITDA margin` } });
  const primary = ['revenue', 'gross_margin', 'prime_cost', 'ebitda', 'ebitda_margin', 'cash'];
  return <div className="finance-overview">
    {dataset.demo ? <div className="finance-demo" role="status">Development demo · All figures are illustrative. No business records are used.</div> : null}
    <AdminSummaryGrid variant="compact" ariaLabel="Financial state" className="mb-6" items={cards} />
    <FinanceMissing ids={primary} metrics={metrics} registry={metricRegistry} />
    <div className="grid min-w-0 gap-6">
    <FinanceOverviewCharts dataset={dataset}/>
    <FinanceAnalysisSurface label="What changed this month?" subtitle="EBITDA movement · Revenue, COGS, Labour and OPEX">
      <DriverContribution compact pair={pair} movement={movement} selectedId={selectedId} selectedStage={selectedStage} onSelect={(id, stage) => { setSelectedId(id); setSelectedStage(stage); if (stage === 'previous') setAction('Compare'); }} />
      {!movement.attributable ? <FinanceReadiness title="Profit movement not ready">Comparable evidence and a validated EBITDA relationship are required.</FinanceReadiness> : null}
      {selectedId ?       <FinanceContext label={metricRegistry[selectedId].label} regionLabel="Selected movement context" action={action} onAction={setAction} evidence={<FinanceDisclosure label={`Evidence & definition for ${metricRegistry[selectedId].label}`}><p>{metricRegistry[selectedId].definition}</p><p>{semantic(metrics[selectedId])} · {metrics[selectedId].completeness} · {metrics[selectedId].reason}</p><FinanceProvenance metric={metrics[selectedId]} />{metrics[selectedId].comparison ? <><p>Previous month · {metrics[selectedId].comparison.completeness}</p><FinanceProvenance metric={metrics[selectedId].comparison} /></> : null}</FinanceDisclosure>}>{action === 'Explain' ? <p><strong>{amount(metrics[selectedId])}</strong> · {metrics[selectedId].reason || metricRegistry[selectedId].definition}</p> : action === 'Compare' ? <p><Comparison metric={metrics[selectedId]} /></p> : <div className="finance-analysis-inputs">{metricRegistry[selectedId].dependencies.map((id) => <button type="button" className="btn-secondary" key={id} onClick={() => setSelectedId(id)}>{metricRegistry[id].label} · {amount(metrics[id])}</button>)}{!metricRegistry[selectedId].dependencies.length ? <p>Finer source evidence is not supplied.</p> : null}</div>}</FinanceContext> : null}
    </FinanceAnalysisSurface>
    </div>
    {attention.length ? <section aria-label="Needs attention"><h3>Needs attention</h3><ul>{attention.map(row => <li key={row.id}>{metricRegistry[row.id].label} share of Revenue increased {row.ratioMovement.value.toFixed(1)}pp. <button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_costs')}>Review Costs</button></li>)}</ul></section> : null}
    <FinanceDisclosure label="Source, freshness & metric definitions"><p>Values are {dataset.demo ? 'development illustrations' : 'authorized operational evidence'}. Actual means book-of-record evidence; Operational means FeedX records; Derived means a disclosed calculation; Forecast means a planning value. Accounting statements retain their own authority.</p>
      <p>{dataset.demo ? 'Fixture timestamp is fixed for reproducible development.' : 'Loaded time records this read. Source freshness is unverified until source timestamps are available.'} Reconciliation: unverified.</p>
      <dl>{Object.entries(metrics).map(([id, metric]) => <div key={id}><dt>{metricRegistry[id].label}</dt><dd>{metric.reason || metricRegistry[id].definition}<br />{metric.completeness} · {semantic(metric)}{metric.provenance[0]?.observedAt ? ` · Loaded ${metric.provenance[0].observedAt}` : ''}</dd></div>)}</dl>
      <h4>Provider capabilities</h4><dl>{Object.entries(dataset.capabilities).map(([id, state]) => <div key={id}><dt>{id.replaceAll('_', ' ')}</dt><dd>{state}</dd></div>)}</dl>
    </FinanceDisclosure>
  </div>;
}
function LiveFinanceWorkspacePage({ section = 'overview', store = {}, auth }) {
  const [mode, setMode] = useState('operational');
  const [month, setMonth] = useState(currentMonth);
  const [outletId, setOutletId] = useState('all');
  const [demoScope, setDemoScope] = useState('group:demo-group');
  const [demoOptions, setDemoOptions] = useState([]);
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [datasetKey,setDatasetKey] = useState(null);
  const requestKey = JSON.stringify([mode,month,outletId,demoScope,section,attempt]);
  const currentDataset = datasetKey === requestKey && !error;
  const outletOptions = [{ value: 'all', label: 'All authorized outlets' }, ...getAccessibleOutletOptions(auth, store.outlets ?? [], { includeAll: false })];
  useEffect(() => {
    if (!financeDemoEnabled || mode !== 'demo') return;
    let active = true;
    import('./providers/fixtureProvider.js').then(({ fixtureScopes }) => { if (active) setDemoOptions(fixtureScopes); });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    if (section !== 'overview') return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    const scope = mode === 'demo' ? demoOptions.find((option) => option.value === demoScope) : outletId === 'all' ? { kind: 'authorized_outlets', id: null } : { kind: 'outlet', id: outletId };
    if (!scope) { setLoading(false); return; }
    const request = { scope: { kind: scope.kind, id: scope.id, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) }, period: monthlyPeriod(month), currency: 'MYR' };
    getFinanceProvider(mode).then((provider) => readFinanceOverview(provider, request, { signal: controller.signal, allowDemo: financeDemoEnabled && mode === 'demo', outlets: mode === 'demo' ? demoOptions.filter(entry => entry.kind === 'outlet').map(entry => ({id: entry.id, name: entry.label, legalEntityId: entry.legalEntityId})) : getAccessibleOutlets(auth, store.outlets ?? []) })).then((result) => { if (active) { setDataset(result); setDatasetKey(requestKey); } }).catch((failure) => { if (active) setError(failure.message || 'Finance is unavailable.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [mode, month, outletId, demoScope, demoOptions, section, attempt]);
  return <WorkspacePage className="finance-workspace" section="Finance" title={sectionLabels[section]} description={sectionDescriptions[section]} controls={section === 'overview' ? <AdminFilterToolbar outlet={<SelectField label={mode === 'demo' ? 'Demo scope' : 'Outlet scope'} value={mode === 'demo' ? demoScope : outletId} onChange={mode === 'demo' ? setDemoScope : setOutletId} options={mode === 'demo' ? demoOptions : outletOptions} />} period={<MonthPickerField label="Period" value={month} onChange={setMonth} />}>
        {financeDemoEnabled ? <SelectField label="Evidence" value={mode} onChange={setMode} options={[{ value: 'operational', label: 'FeedX operational' }, { value: 'demo', label: 'Development demo' }]} /> : null}
      </AdminFilterToolbar> : null}>
    {section === 'overview' ? <>
      <AsyncDataSurface loading={loading} error={error} hasData={Boolean(dataset) && currentDataset} isEmpty={!dataset} emptyTitle="Select financial evidence" emptyDescription="Choose a scope to review its financial state." onRetry={() => setAttempt((value) => value + 1)}/>
      {dataset ? <div hidden={!currentDataset || loading}><FinanceOverview dataset={dataset}/><FinanceDataStatus dataset={dataset} loading={loading} error={error}/></div> : null}
    </> : section === 'statements' ? <FinanceStatements /> : <FinancePlanningReadiness /> }
  </WorkspacePage>;
}

export default function FinanceWorkspacePage(props) { const section=props.section ?? "overview"; return <FinancePreviewBoundary auth={props.auth} section={section}><LiveFinanceWorkspacePage {...props}/></FinancePreviewBoundary>; }
