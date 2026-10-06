import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { getAccessibleOutletOptions } from '../../utils/accessControl.js';
import { money, periodLabel } from '../reports/components/reportingFormatters.js';
import { navigateAdminRoute } from '../../app/routeOwnership.js';
import { financeDemoEnabled, getFinanceProvider, readFinanceOverview } from './financeService.js';
import { monthlyPeriod } from './foundation.js';
import { metricRegistry } from './metrics.js';
import './finance.css';

const sectionLabels = { overview: 'Overview', analysis: 'Analysis', costs: 'Costs', cash: 'Cash', planning: 'Planning', statements: 'Statements' };
const futureDescriptions = {
  analysis: 'Profit drivers and outlet, product and category profitability will build on validated financial evidence.',
  costs: 'COGS, Labour, Prime Cost and OPEX will share one classification and metric model.',
  cash: 'Cash, payables, receivables and working capital require validated accounting balances.',
  planning: 'Forecasts, Profit Levers, scenarios and capital allocation will carry separate planning provenance.',
};
function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}
function amount(metric) { return metric?.unit === 'percent' ? metric.value === null ? '—' : `${metric.value.toFixed(1)}%` : money({ amount: metric?.value, presence: metric?.value === null || metric?.value === undefined ? 'missing' : 'present' }); }
function semantic(metric) { return [...new Set(metric?.provenance?.map((p) => p.semantic) ?? [])].map((s) => s[0] + s.slice(1).toLowerCase()).join(' / ') || 'Unavailable'; }
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
  const flowStart = (id) => id === 'cogs' ? metrics.gross_profit.value : id === 'labour' && metrics.ebitda.value !== null && metrics.opex.value !== null ? metrics.ebitda.value + metrics.opex.value : id === 'opex' ? metrics.ebitda.value : 0;
  const flow = ['revenue', 'cogs', 'gross_profit', 'labour', 'opex', 'ebitda'];
  const primary = ['revenue', 'gross_margin', 'prime_cost', 'ebitda', 'ebitda_margin', 'cash'];
  const available = primary.filter((id) => metrics[id].value !== null).length;
  return <div className="finance-overview">
    {dataset.demo ? <div className="finance-demo" role="status">Development demo · All figures are illustrative. No business records are used.</div> : null}
    <section className="finance-state" aria-label="Financial state">
      <div><span className="finance-label">Financial state · {periodLabel({ year: Number(dataset.period.start.slice(0, 4)), month: Number(dataset.period.start.slice(5, 7)) })}</span><h2>{dataset.demo ? 'Profit, with context.' : available < primary.length ? 'A partial financial picture.' : 'Your financial position.'}</h2><p>{dataset.sourceLabel}. {available} of {primary.length} Overview measures available.</p></div>
      <Metric metric={metrics.ebitda} prominent />
    </section>
    <div className="finance-measures">{primary.filter((id) => id !== 'ebitda').map((id) => <Metric key={id} metric={metrics[id]} />)}</div>
    <section className="finance-flow" aria-labelledby="finance-flow-title">
      <div className="finance-section-heading"><div><h3 id="finance-flow-title">How your profit is made</h3><p>{dataset.demo ? 'Revenue flows through cost of goods, labour and operating expense to EBITDA.' : 'Existing Reporting EBITDA retains its operational calculation. Missing accounting inputs are shown explicitly.'}</p></div><span className="finance-label">Profit Flow</span></div>
      <ol>{flow.map((id, index) => <li key={id} className={['cogs', 'labour', 'opex'].includes(id) ? 'finance-flow-deduction' : 'finance-flow-retained'}>
        <span className="finance-flow-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="finance-flow-value"><span>{metricRegistry[id].label}</span><strong>{amount(metrics[id])}</strong></div>
        <div className="finance-flow-track" aria-hidden="true"><span style={{ marginLeft: metrics.revenue.value > 0 && flowStart(id) !== null ? `${Math.max(0, Math.min(100, flowStart(id) / metrics.revenue.value * 100))}%` : '0%', width: metrics.revenue.value > 0 && metrics[id].value !== null ? `${Math.max(0, Math.min(100, metrics[id].value / metrics.revenue.value * 100))}%` : '0%' }} /></div>
        <span className="finance-semantic">{semantic(metrics[id])}{metrics[id].completeness === 'partial' ? ' · Partial' : ''}</span>
      <details className="finance-flow-detail"><summary>Evidence for {metricRegistry[id].label}</summary><p>{metrics[id].reason || metricRegistry[id].definition} · {metrics[id].completeness}</p><p>{semantic(metrics[id])}{dataset.demo ? " · Development demo" : ""}</p></details>
      </li>)}</ol>
    </section>
    <details className="finance-evidence"><summary>Source, freshness & metric definitions</summary><p>Values are {dataset.demo ? 'development illustrations' : 'authorized operational evidence'}. Actual means book-of-record evidence; Operational means FeedX records; Derived means a disclosed calculation; Forecast means a planning value. Accounting statements retain their own authority.</p>
      <p>{dataset.demo ? 'Fixture timestamp is fixed for reproducible development.' : 'Loaded time records this read. Source freshness is unverified until source timestamps are available.'} Reconciliation: unverified.</p>
      <dl>{Object.entries(metrics).map(([id, metric]) => <div key={id}><dt>{metricRegistry[id].label}</dt><dd>{metric.reason || metricRegistry[id].definition}<br />{metric.completeness} · {semantic(metric)}{metric.provenance[0]?.observedAt ? ` · Loaded ${metric.provenance[0].observedAt}` : ''}</dd></div>)}</dl>
      <h4>Provider capabilities</h4><dl>{Object.entries(dataset.capabilities).map(([id, state]) => <div key={id}><dt>{id.replaceAll('_', ' ')}</dt><dd>{state}</dd></div>)}</dl>
    </details>
  </div>;
}
function StatementsFoundation() {
  return <section className="finance-foundation"><h2>Financial statements</h2><p>Accounting statements and operational management reporting retain separate source authority.</p>
    <div className="finance-statement-row"><div><h3>Profit & Loss</h3><p>Monthly and Yearly/YTD management P&L remain available through the existing Reporting service.</p><span className="finance-semantic">Operational · Purchase-based COGS</span></div><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('reports')}>Open Monthly / Yearly P&L <ArrowRight size={15} /></button></div>
    <div className="finance-statement-row"><div><h3>Balance Sheet</h3><p>Awaiting a validated provider statement or authoritative account balances.</p></div><span className="finance-semantic">Unavailable</span></div>
    <div className="finance-statement-row"><div><h3>Cash Flow</h3><p>Awaiting validated accounting evidence and cash-flow classifications.</p></div><span className="finance-semantic">Unavailable</span></div>
  </section>;
}
export default function FinanceWorkspacePage({ section = 'overview', store = {}, auth }) {
  const [mode, setMode] = useState('operational');
  const [month, setMonth] = useState(currentMonth);
  const [outletId, setOutletId] = useState('all');
  const [demoScope, setDemoScope] = useState('group:demo-group');
  const [demoOptions, setDemoOptions] = useState([]);
  const [dataset, setDataset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
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
  }, [mode, month, outletId, demoScope, demoOptions, section, refresh]);
  return <div className="finance-workspace space-y-5">
    <PageHeader section="Finance" title={sectionLabels[section]} description={section === 'overview' ? 'Financial state, its sources, and how your profit is made.' : 'Financial statements, analysis and future planning.'} />
    {section === 'overview' ? <>
      <AdminFilterToolbar primaryActions={<button className="btn-secondary" type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} />Refresh</button>}>
        {financeDemoEnabled ? <SelectField label="Evidence" value={mode} onChange={setMode} options={[{ value: 'operational', label: 'FeedX operational' }, { value: 'demo', label: 'Development demo' }]} /> : null}
        <SelectField label={mode === 'demo' ? 'Demo scope' : 'Outlet scope'} value={mode === 'demo' ? demoScope : outletId} onChange={mode === 'demo' ? setDemoScope : setOutletId} options={mode === 'demo' ? demoOptions : outletOptions} />
        <MonthPickerField label="Period" value={month} onChange={setMonth} />
      </AdminFilterToolbar>
      <AsyncDataSurface loading={loading} error={error} hasData={Boolean(dataset)} isEmpty={!dataset} emptyTitle="Select financial evidence" emptyDescription="Choose a scope to review its financial state." onRetry={() => setRefresh((value) => value + 1)}>{dataset ? <FinanceOverview dataset={dataset} /> : null}</AsyncDataSurface>
    </> : section === 'statements' ? <StatementsFoundation /> : <section className="finance-foundation"><span className="finance-label">Foundation established</span><h2>{sectionLabels[section]}</h2><p>{futureDescriptions[section]}</p><p>Available in a future phase, once its evidence and authority are validated.</p><button type="button" className="btn-secondary" onClick={() => navigateAdminRoute('finance_overview')}>Review financial state <ArrowRight size={15} /></button></section>}
  </div>;
}
