import FinancePreviewBoundary from './FinancePreviewBoundary.jsx';
import { ProfitArchitecture } from './FinanceAnalyticalVisuals.jsx';
import { FinanceReadiness, FinanceDisclosure, FinanceMissing, FinanceContext, FinanceProvenance } from './FinanceVisualSystem.jsx';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { getAccessibleOutletOptions } from '../../utils/accessControl.js';
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
  overview: 'Financial state, its sources, and how your profit is made.',
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
function Metric({ metric, prominent = false }) {
  return <div className={`finance-metric ${prominent ? 'finance-metric-prominent' : ''}`}>
    <span className="finance-label">{metricRegistry[metric.id].label}</span>
    <strong>{amount(metric)}</strong>
    <span className="finance-semantic">{semantic(metric)} · {metric.completeness}</span>
    <span className="finance-comparison"><Comparison metric={metric} /></span>
  </div>;
}
export function FinanceOverview({ dataset }) {
  const metrics = dataset.metrics;
  const [selectedId, setSelectedId] = useState('ebitda');
  const [action, setAction] = useState('Explain');

  const primary = ['revenue', 'gross_margin', 'prime_cost', 'ebitda', 'ebitda_margin', 'cash'];
  const available = primary.filter((id) => metrics[id].value !== null).length;
  return <div className="finance-overview">
    {dataset.demo ? <div className="finance-demo" role="status">Development demo · All figures are illustrative. No business records are used.</div> : null}
    <section data-workspace-surface="summary" className="finance-state" aria-label="Financial state">
      <div><span className="finance-label">Financial state · {periodLabel({ year: Number(dataset.period.start.slice(0, 4)), month: Number(dataset.period.start.slice(5, 7)) })}</span><h2>{dataset.demo ? 'Profit, with context.' : available < primary.length ? 'A partial financial picture.' : 'Your financial position.'}</h2><p>{dataset.sourceLabel}. {available} of {primary.length} Overview measures available.</p></div>
      <div className="finance-primary-state"><Metric metric={metrics.ebitda} prominent /><Metric metric={metrics.ebitda_margin} /></div>
    </section>
    <div className="finance-measures">{primary.filter((id) => !['ebitda', 'ebitda_margin'].includes(id) && metrics[id].value !== null).map((id) => <Metric key={id} metric={metrics[id]} />)}</div>
    <FinanceMissing ids={primary} metrics={metrics} registry={metricRegistry} />
    <section data-workspace-surface="analysis" className="finance-flow" aria-labelledby="finance-flow-title">
      <div className="finance-section-heading"><div><h3 id="finance-flow-title">Profit Architecture</h3><p>{dataset.demo ? 'Revenue flows through cost of goods, labour and operating expense to EBITDA.' : 'Existing Reporting EBITDA retains its operational calculation. Missing accounting inputs are shown explicitly.'}</p></div><span className="finance-label">Profit Flow</span></div>
      <ProfitArchitecture dataset={dataset} selectedId={selectedId} onSelect={setSelectedId} />
      <p className="finance-analysis-muted">{dataset.demo ? 'Development illustration · supplied revenue and cost inputs retain their disclosed basis.' : 'Operational EBITDA retains purchase-based COGS. Labour is not separately established; no missing input is inferred or deducted again.'}</p>
      <FinanceContext label={metricRegistry[selectedId].label} regionLabel="Selected Profit Flow context" action={action} onAction={setAction} evidence={<FinanceDisclosure label={`Evidence & definition for ${metricRegistry[selectedId].label}`}><p>{metricRegistry[selectedId].definition}</p><p>{semantic(metrics[selectedId])} · {metrics[selectedId].completeness} · {metrics[selectedId].reason}</p><FinanceProvenance metric={metrics[selectedId]} />{metrics[selectedId].comparison ? <><p>Previous month · {metrics[selectedId].comparison.completeness}</p><FinanceProvenance metric={metrics[selectedId].comparison} /></> : null}</FinanceDisclosure>}>{action === 'Explain' ? <p>{metrics[selectedId].reason || metricRegistry[selectedId].definition}</p> : action === 'Compare' ? <p><Comparison metric={metrics[selectedId]} /></p> : <div className="finance-analysis-inputs">{metricRegistry[selectedId].dependencies.map((id) => <button type="button" className="btn-secondary" key={id} onClick={() => setSelectedId(id)}>{metricRegistry[id].label} · {amount(metrics[id])}</button>)}{!metricRegistry[selectedId].dependencies.length ? <p>Finer source evidence is not supplied.</p> : null}</div>}</FinanceContext>
    </section>
    <nav className="finance-paths" aria-label="Continue financial investigation">{[['analysis', 'Analysis', 'What changed & why'], ['costs', 'Costs', 'Where margin is consumed'], ['cash', 'Cash', 'Liquidity & capital conversion']].map(([route, label, detail]) => <button type="button" key={route} onClick={() => navigateAdminRoute(`finance_${route}`)}><strong>{label}</strong><span>{detail}</span><ArrowRight size={16} /></button>)}</nav>
    <FinanceDisclosure label="Source, freshness & metric definitions"><p>Values are {dataset.demo ? 'development illustrations' : 'authorized operational evidence'}. Actual means book-of-record evidence; Operational means FeedX records; Derived means a disclosed calculation; Forecast means a planning value. Accounting statements retain their own authority.</p>
      <p>{dataset.demo ? 'Fixture timestamp is fixed for reproducible development.' : 'Loaded time records this read. Source freshness is unverified until source timestamps are available.'} Reconciliation: unverified.</p>
      <dl>{Object.entries(metrics).map(([id, metric]) => <div key={id}><dt>{metricRegistry[id].label}</dt><dd>{metric.reason || metricRegistry[id].definition}<br />{metric.completeness} · {semantic(metric)}{metric.provenance[0]?.observedAt ? ` · Loaded ${metric.provenance[0].observedAt}` : ''}</dd></div>)}</dl>
      <h4>Provider capabilities</h4><dl>{Object.entries(dataset.capabilities).map(([id, state]) => <div key={id}><dt>{id.replaceAll('_', ' ')}</dt><dd>{state}</dd></div>)}</dl>
    </FinanceDisclosure>
  </div>;
}
function StatementsFoundation() {
  return <section className="finance-foundation"><h2>Financial statements</h2><p>Accounting statements and operational management reporting retain separate source authority.</p>
    <div className="finance-statement-row"><div><h3>Profit & Loss</h3><p>Monthly and Yearly/YTD management P&L remain available through the existing Reporting service.</p><span className="finance-semantic">Operational · Purchase-based COGS</span></div><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('reports')}>Open Monthly / Yearly P&L <ArrowRight size={15} /></button></div>
    <div className="finance-statement-row"><div><h3>Balance Sheet</h3><p>Awaiting a validated provider statement or authoritative account balances.</p></div><span className="finance-semantic">Unavailable</span></div>
    <div className="finance-statement-row"><div><h3>Cash Flow</h3><p>Awaiting validated accounting evidence and cash-flow classifications.</p></div><span className="finance-semantic">Unavailable</span></div>
  </section>;
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
    setLoading(true); setError(''); setDataset(null);
    const scope = mode === 'demo' ? demoOptions.find((option) => option.value === demoScope) : outletId === 'all' ? { kind: 'authorized_outlets', id: null } : { kind: 'outlet', id: outletId };
    if (!scope) { setLoading(false); return; }
    const request = { scope: { kind: scope.kind, id: scope.id, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) }, period: monthlyPeriod(month), currency: 'MYR' };
    getFinanceProvider(mode).then((provider) => readFinanceOverview(provider, request, { allowDemo: financeDemoEnabled && mode === 'demo' })).then((result) => { if (active) setDataset(result); }).catch((failure) => { if (active) setError(failure.message || 'Finance is unavailable.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, month, outletId, demoScope, demoOptions, section, attempt]);
  return <WorkspacePage className="finance-workspace" section="Finance" title={sectionLabels[section]} description={sectionDescriptions[section]} controls={section === 'overview' ? <AdminFilterToolbar>
        {financeDemoEnabled ? <SelectField label="Evidence" value={mode} onChange={setMode} options={[{ value: 'operational', label: 'FeedX operational' }, { value: 'demo', label: 'Development demo' }]} /> : null}
        <SelectField label={mode === 'demo' ? 'Demo scope' : 'Outlet scope'} value={mode === 'demo' ? demoScope : outletId} onChange={mode === 'demo' ? setDemoScope : setOutletId} options={mode === 'demo' ? demoOptions : outletOptions} />
        <MonthPickerField label="Period" value={month} onChange={setMonth} />
      </AdminFilterToolbar> : null}>
    {section === 'overview' ? <>
      <AsyncDataSurface loading={loading} error={error} hasData={Boolean(dataset)} isEmpty={!dataset} emptyTitle="Select financial evidence" emptyDescription="Choose a scope to review its financial state." onRetry={() => setAttempt((value) => value + 1)}>{dataset ? <><FinanceOverview dataset={dataset} /><FinanceDataStatus dataset={dataset} loading={loading} error={error} /></> : null}</AsyncDataSurface>
    </> : section === 'statements' ? <StatementsFoundation /> : <section className="finance-future"><h2>Foundation established</h2><p>This workspace will become available once its financial evidence and authority are validated.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_overview')}>Review financial state <ArrowRight size={15} /></button></section>}
  </WorkspacePage>;
}

export default function FinanceWorkspacePage(props) { const section=props.section ?? "overview"; return section === "overview" ? <FinancePreviewBoundary auth={props.auth} section={section}><LiveFinanceWorkspacePage {...props}/></FinancePreviewBoundary> : <LiveFinanceWorkspacePage {...props}/>; }
