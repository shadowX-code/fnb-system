import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { useEffect, useState } from 'react';
import { Link2, ShieldCheck } from 'lucide-react';
import PageHeader from '../../components/layout/PageHeader.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
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
  return <div className="finance-source-empty"><h3>{title}</h3><p>{children}</p></div>;
}
function ConnectionSection({ state }) {
  return <section aria-label="Accounting connections">
    <div className="finance-section-heading"><div><h2>Accounting connections</h2><p>Provider access, legal entity binding and retained history.</p></div><Link2 size={20} aria-hidden="true" /></div>
    {!state.connections.length ? <p className="finance-source-note">Connect and validate an accounting provider to establish its legal entity binding and retained history.</p> : state.connections.map((entry) => {
      const periods = state.authorityPeriods.filter((period) => period.connectionId === entry.connection.id);
      const successfulSyncs = entry.sync.map((sync) => sync.lastSuccessAt).filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
      return <article key={entry.connection.id} className="finance-source-connection">
        <div className="finance-section-heading"><h3>{entry.providerLabel}</h3><span className="finance-semantic">{entry.status === 'historical' ? 'Historical' : 'Active'} · {entry.state}</span></div>
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
    <p id="finance-connection-boundary" className="finance-source-note">Connection setup and accounting sync are not available yet. Provider actions will be enabled here once their evidence and access controls are validated.</p>
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
      return <div key={kind} className="finance-source-mapping"><h3>{label}</h3>{!evidence.length ? <p>Not assessed · no provider mapping evidence.</p> : evidence.map((entry) => {
        const connection = state.connections.find((source) => source.connection.id === entry.connectionId);
        return <div key={`${entry.connectionId}:${entry.scope.kind}:${entry.scope.id}:${entry.period.start}`}><strong>{entry.mapped} mapped · {entry.unresolved} unresolved</strong><p>{connection?.providerLabel ?? 'Source unavailable'} · {connection?.legalEntityLabel ?? 'Binding unavailable'} · {entry.scopeLabel ?? entry.scope.kind.replaceAll("_", " ")} · {periodLabel(entry.period)}</p></div>;
      })}</div>;
    })}
  </section>;
}
function ReconciliationSection({ state }) {
  return <section aria-label="Financial reconciliation"><h2>Reconciliation</h2><p className="finance-source-note">Compare validated accounting evidence with FeedX for a specific period and financial measure.</p>
    {!state.reconciliations.length ? <FoundationNotice title="No validated reconciliation evidence">Period, source, metric or balance, difference and reconciliation state will appear here when comparable evidence is available. No accounting comparison has been created.</FoundationNotice> : <div className="finance-source-table-wrap"><table className="finance-source-table"><caption className="sr-only">Validated financial comparisons</caption><thead><tr><th>Period</th><th>Source</th><th>Metric / balance</th><th>Difference</th><th>State</th></tr></thead><tbody>{state.reconciliations.map((entry, index) => <tr key={`${entry.connectionId}:${entry.metricId}:${index}`}><td>{periodLabel(entry.period)}</td><td>{entry.sourceLabel}</td><td>{metricRegistry[entry.metricId]?.label ?? entry.metricId}</td><td>{difference(entry)}</td><td>{entry.reconciliation.status}</td></tr>)}</tbody></table></div>}
  </section>;
}
export function FinanceDataSources({ state }) {
  const [section, setSection] = useState('Connection');
  const readiness = dataSourceReadiness(state);
  const panels = { Connection: ConnectionSection, Authority: AuthoritySection, Mapping: MappingSection, Reconciliation: ReconciliationSection };
  const Panel = panels[section];
  return <>
    {!state.connections.length ? <div className="finance-source-intro"><h2>No accounting provider connected</h2><p>Operational reporting is available. Accounting statements, balances and mapping await validated provider evidence.</p></div> : null}
    <FinanceDisclosure label="Financial data readiness">    <section className="finance-source-health" aria-label="Data health"><h2>Financial data readiness</h2><dl>{readiness.summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><strong>{item.value}</strong><span>{item.detail}</span></dd></div>)}</dl><FinanceDisclosure label="Known readiness blockers"><ul>{readiness.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></FinanceDisclosure></section>
</FinanceDisclosure>
    <AdminSegmentedControl className="finance-source-tabs" label="Data source concerns" value={section} onChange={setSection} options={sections.map((label) => ({ value: label, label, panelId: 'finance-data-source-panel' }))} />
    <div id="finance-data-source-panel" role="tabpanel" aria-label={section} className="finance-source-panel"><Panel state={state} /></div>
  </>;
}
export default function FinanceDataSourcesPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    readFinanceDataSources().then((next) => { if (active) setState(next); }).catch(() => { if (active) setError('Financial source status could not be loaded.'); });
    return () => { active = false; };
  }, [attempt]);
  return <div className="finance-workspace space-y-5">
    <PageHeader section="Finance · Manage" title="Data Sources" description="Manage where financial evidence comes from and whether it is usable." primaryActions={<button type="button" className="btn-secondary" disabled aria-describedby="finance-connect-availability"><Link2 size={15} />Connect provider</button>} />
    <p id="finance-connect-availability" className="finance-source-note">Accounting connections are not available yet. FeedX operational reporting remains available.</p>
    <AsyncDataSurface loading={!state && !error} error={error} hasData={Boolean(state)} onRetry={() => setAttempt((value) => value + 1)}>{state ? <FinanceDataSources state={state} /> : null}</AsyncDataSurface>
  </div>;
}
