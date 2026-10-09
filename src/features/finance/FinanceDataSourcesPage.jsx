import DashboardSection from '../../components/layout/DashboardSection.jsx';
import FinanceAnalysisSurface from './FinanceAnalysisSurface.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { useEffect, useState } from 'react';
import { Link2, ShieldCheck } from 'lucide-react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import FinancePreviewBoundary from './FinancePreviewBoundary.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { money } from '../reports/components/reportingFormatters.js';
import { metricRegistry } from './metrics.js';
import { connectionActions, dataSourceReadiness, mappingLabels, readFinanceDataSources } from './dataSources.js';
import './finance.css';

const sections = ['Connection', 'Authority', 'Mapping', 'Reconciliation'];
const capabilityLabels = {
  chart_of_accounts: 'Chart of accounts', transactions: 'Transactions', journal_lines: 'Journal lines',
  account_balances: 'Account balances', financial_dimensions: 'Financial dimensions',
  inventory_valuation: 'Inventory valuation', profit_loss_report: 'Profit & Loss report',
  balance_sheet_report: 'Balance Sheet report', cash_flow_report: 'Cash Flow report',
  incremental_sync: 'Incremental sync', webhooks: 'Webhooks',
};
const dateFormatter = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
function timestamp(value) { return value && Number.isFinite(Date.parse(value)) ? dateFormatter.format(new Date(value)) : 'Unavailable'; }
function difference(entry) {
  if (entry.difference === null) return '—';
  if (metricRegistry[entry.metricId]?.unit === 'percent') return `${entry.difference.toFixed(1)} pp`;
  if (entry.currency === 'MYR') return money({ amount: entry.difference, presence: 'present' });
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: entry.currency }).format(entry.difference);
}
function periodLabel(period) { return `${period.start} → ${period.end}`; }
function Capabilities({ values }) {
  return <dl className="finance-source-facts">{Object.entries(values).map(([id, state]) => <div key={id}><dt>{capabilityLabels[id] ?? id}</dt><dd>{state}</dd></div>)}</dl>;
}
function FoundationNotice({ title, children }) {
  return <EmptyState className="mt-4" title={title} description={children} icon={ShieldCheck} />;
}
function ConnectionSection({ state }) {
  return <section aria-label="Accounting connections">
    <div className="finance-section-heading"><div><h2>Accounting connections</h2><p>Provider access, legal entity binding and retained history.</p></div><Link2 size={20} aria-hidden="true" /></div>
    {!state.connections.length ? <EmptyState className="my-4" title="No accounting provider connected" description="Operational reporting is available. Accounting statements and balances require validated provider evidence." icon={Link2} /> : state.connections.map((entry) => {
      const periods = state.authorityPeriods.filter((period) => period.connectionId === entry.connection.id);
      const successfulSyncs = entry.sync.map((sync) => sync.lastSuccessAt).filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
      return <article key={entry.connection.id} className="finance-source-connection">
        <div className="finance-section-heading"><h3>{entry.providerLabel}</h3><StatusBadge status="neutral">{entry.status === 'historical' ? 'Historical' : 'Active'} · {entry.state}</StatusBadge></div>
        <dl className="finance-source-facts">
          <div><dt>Legal entity</dt><dd>{entry.legalEntityLabel}</dd></div>
          <div><dt>Last successful sync</dt><dd>{timestamp(successfulSyncs.at(-1))}</dd></div>
          <div><dt>Source freshness</dt><dd>{entry.evidenceAt ? timestamp(entry.evidenceAt) : 'Not assessed · sync time alone does not prove complete evidence'}</dd></div>
          <div><dt>Effective authority</dt><dd>{periods.length ? periods.map((period) => <div key={`${period.resource}:${period.start}`}>{period.resource} · {periodLabel(period)}</div>) : 'Not assigned'}</dd></div>
        </dl>
        {entry.status === 'historical' ? <p className="finance-source-note">Historical visibility preserves the source of earlier evidence. Deactivation does not delete financial history.</p> : null}
        <FinanceDisclosure label="Provider capabilities"><Capabilities values={entry.connection.capabilities} /></FinanceDisclosure>
        <div className="finance-source-actions" aria-label={`${entry.providerLabel} future actions`}>{connectionActions.filter((action) => action.id !== 'connect').map((action) => <button key={action.id} type="button" className="btn-secondary" disabled aria-describedby="finance-connection-boundary">{action.label}</button>)}</div>
      </article>;
    })}
    <p id="finance-connection-boundary" className="finance-source-note">Provider setup and accounting sync are not available. Actions remain disabled.</p>
    <FinanceDisclosure label="FeedX operational source capabilities"><p>{state.operationalSource.label} supplies the existing outlet-scoped management P&L. It is separate from an accounting provider connection.</p><Capabilities values={state.operationalSource.capabilities} /></FinanceDisclosure>
  </section>;
}
function AuthoritySection({ state }) {
  return <section aria-label="Source authority">
    <div className="finance-section-heading"><div><h2>Source authority</h2><p>Accounting authority is assigned by legal entity, evidence resource and effective period.</p></div><ShieldCheck size={20} aria-hidden="true" /></div>
    <dl className="finance-source-facts finance-authority-semantics">
      <div><dt>Accounting Actual</dt><dd>{state.connections.length ? 'Only evidence covered by a validated accounting authority period.' : 'Unavailable · no accounting provider connected.'}</dd></div>
      <div><dt>FeedX Operational</dt><dd>{state.operationalSource.label} owns existing operational P&L calculations, including purchase-based COGS and management EBITDA.</dd></div>
      <div><dt>Derived</dt><dd>Disclosed calculations retain their input provenance. They do not replace accounting statement evidence.</dd></div>
      <div><dt>Forecast</dt><dd>Unavailable · no validated planning source is configured.</dd></div>
    </dl>
    <h3 className="finance-source-subheading">Accounting authority periods</h3>
    {!state.authorityPeriods.length ? <FoundationNotice title="No accounting authority periods">Authority coverage cannot be assessed without a legal entity, source and effective period.</FoundationNotice> : <div className="finance-source-table-wrap"><table className="finance-source-table"><caption className="sr-only">Historical and active accounting authority periods</caption><thead><tr><th>Source</th><th>Legal entity</th><th>Evidence</th><th>Effective period</th><th>Provider status</th></tr></thead><tbody>{state.authorityPeriods.map((period) => {
      const entry = state.connections.find((connection) => connection.connection.id === period.connectionId);
      return <tr key={`${period.connectionId}:${period.resource}:${period.start}`}><td>{entry?.providerLabel ?? 'Source unavailable'}</td><td>{entry?.legalEntityLabel ?? 'Binding unavailable'}</td><td>{period.resource}</td><td>{periodLabel(period)}</td><td>{entry?.status === 'historical' ? 'Historical' : entry?.status === 'active' ? 'Active' : 'Unknown'}</td></tr>;
    })}</tbody></table></div>}
    <p className="finance-source-note">A provider change applies to its assigned period. Earlier evidence retains its original source; gaps remain unavailable.</p>
  </section>;
}
function MappingSection({ state }) {
  return <section aria-label="Mapping readiness"><h2>Mapping readiness</h2><p className="finance-source-note">Mappings connect provider identities to existing FeedX owners. Counts are shown only when provider records have been assessed.</p>
    {Object.entries(mappingLabels).map(([kind, label]) => {
      const evidence = state.mappingReadiness.filter((entry) => entry.kind === kind);
      return <div key={kind} className="finance-source-mapping"><h3>{label}</h3>{!evidence.length ? <p className="flex flex-wrap items-center gap-2"><StatusBadge status="neutral">Not assessed</StatusBadge><span>No provider mapping evidence.</span></p> : evidence.map((entry) => {
        const connection = state.connections.find((source) => source.connection.id === entry.connectionId);
        return <div key={`${entry.connectionId}:${entry.scope.kind}:${entry.scope.id}:${entry.period.start}`}><strong>{entry.mapped} mapped · {entry.unresolved} unresolved</strong><p>{connection?.providerLabel ?? 'Source unavailable'} · {connection?.legalEntityLabel ?? 'Binding unavailable'} · {entry.scopeLabel ?? entry.scope.kind.replaceAll("_", " ")} · {periodLabel(entry.period)}</p></div>;
      })}</div>;
    })}
  </section>;
}
function ReconciliationSection({ state }) {
  return <section aria-label="Financial reconciliation"><h2>Reconciliation</h2><p className="finance-source-note">Compare validated accounting evidence with FeedX for a specific period and financial measure.</p>
    {!state.reconciliations.length ? <FoundationNotice title="No validated reconciliation evidence">Comparable accounting evidence is required for a validated period, measure and difference.</FoundationNotice> : <div className="finance-source-table-wrap"><table className="finance-source-table"><caption className="sr-only">Validated financial comparisons</caption><thead><tr><th>Period</th><th>Source</th><th>Metric / balance</th><th>Difference</th><th>State</th></tr></thead><tbody>{state.reconciliations.map((entry, index) => <tr key={`${entry.connectionId}:${entry.metricId}:${index}`}><td>{periodLabel(entry.period)}</td><td>{entry.sourceLabel}</td><td>{metricRegistry[entry.metricId]?.label ?? entry.metricId}</td><td>{difference(entry)}</td><td>{entry.reconciliation.status}</td></tr>)}</tbody></table></div>}
  </section>;
}
export function FinanceDataSources({ state }) {
  const [section, setSection] = useState('Connection');
  const readiness = dataSourceReadiness(state);
  const panels = { Connection: ConnectionSection, Authority: AuthoritySection, Mapping: MappingSection, Reconciliation: ReconciliationSection };
  const Panel = panels[section];
  return <div className="grid min-w-0 gap-6">
    <DashboardSection title="Financial data readiness" subtitle="Operational reporting and accounting evidence retain separate authority." action={<StatusBadge status={state.connections.length ? 'info' : 'neutral'}>{state.connections.length ? 'Provider evidence retained' : 'No provider connected'}</StatusBadge>}>
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Data health">{readiness.summary.map(item => <div key={item.label} className="min-w-0"><dt className="type-caption text-text-secondary">{item.label}</dt><dd className="mt-2"><strong className="block type-body-sm text-text-primary">{item.value}</strong><span className="mt-1 block type-caption leading-relaxed text-text-secondary">{item.detail}</span></dd></div>)}</dl>
      {readiness.issues.length ? <FinanceDisclosure label="Known readiness blockers"><ul className="list-disc space-y-2 pl-4">{readiness.issues.map(issue => <li key={issue}>{issue}</li>)}</ul><div className="flex flex-wrap gap-2">{sections.map(tab => <button type="button" key={tab} className="btn-secondary" onClick={() => setSection(tab)}>Review {tab}</button>)}</div></FinanceDisclosure> : null}
    </DashboardSection>
    <FinanceAnalysisSurface label="Data source concerns" title="Source management" subtitle="Connection status, authority coverage and evidence controls" modes={sections} value={section} onChange={setSection}><Panel state={state}/></FinanceAnalysisSurface>
  </div>;
}
function LiveFinanceDataSourcesPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    readFinanceDataSources().then((next) => { if (active) setState(next); }).catch(() => { if (active) setError('Financial source status could not be loaded.'); });
    return () => { active = false; };
  }, [attempt]);
  return <WorkspacePage className="finance-workspace" section="Finance · Manage" title="Data Sources" description="Manage where financial evidence comes from and whether it is usable." actions={<button type="button" className="btn-secondary" disabled aria-describedby="finance-connect-availability"><Link2 size={15} />Connect provider</button>}>
    <p id="finance-connect-availability" className="sr-only">Accounting connections are not available yet. FeedX operational reporting remains available.</p>
    <AsyncDataSurface loading={!state && !error} error={error} hasData={Boolean(state)} onRetry={() => setAttempt((value) => value + 1)}>{state ? <FinanceDataSources state={state} /> : null}</AsyncDataSurface>
  </WorkspacePage>;
}

export default function FinanceDataSourcesPage(props) { return <FinancePreviewBoundary auth={props.auth} section="data_sources"><LiveFinanceDataSourcesPage /></FinancePreviewBoundary>; }
