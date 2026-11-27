import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { AdminEvidenceDisclosure } from '../../components/layout/AdminAnalyticalSurface.jsx';
import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { useEffect, useId, useState } from 'react';
import { ArrowRight, Link2 } from 'lucide-react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import FinancePreviewBoundary from './FinancePreviewBoundary.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { money } from '../reports/components/reportingFormatters.js';
import { metricRegistry } from './metrics.js';
import { dataSourceReadiness, mappingLabels, partitionAccountingConnections, readFinanceDataSources } from './dataSources.js';
import { AutoCountActionModal, AutoCountDevices, AutoCountDiagnostics, AutoCountStatus, AutoCountSyncSummary, autoCountOnline } from './AutoCountConnector.jsx';
import FinanceAccountMapping from './FinanceAccountMapping.jsx';
import AccountingDatasetBrowser from './AccountingDatasetBrowser.jsx';
import './finance.css';

const sections = ['Connection', 'Authority', 'Mapping', 'Reconciliation'];
const detailTabs = ['Overview', 'Capabilities', 'Diagnostics'];
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
const capabilityStateLabels = { supported: 'Supported', partial: 'Observed in FeedX', unverified: 'Unverified', unsupported: 'Unsupported' };
const datasetLabels = { COA: 'Chart of accounts', GL: 'General ledger', Department: 'Departments', Project: 'Projects' };
const dayMs = 24 * 60 * 60 * 1000;

function Capabilities({ values }) {
  return <dl className="grid gap-2 type-body-sm">{Object.entries(values).map(([id, state]) => <div className="flex flex-wrap justify-between gap-x-3" key={id}>
    <dt>{capabilityLabels[id] ?? id}</dt><dd className="text-text-secondary">{capabilityStateLabels[state] ?? state}</dd>
  </div>)}</dl>;
}

function BookDatasetCounts({ entry }) {
  return <dl aria-label="Book dataset acceptance" className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
    {Object.entries(datasetLabels).map(([dataset, label]) => {
      const snapshot = entry.datasets?.find((item) => item.dataset === dataset);
      const count = dataset === 'GL' && entry.glCoverage?.acceptedDays ? entry.glCoverage.acceptedRows : snapshot?.acceptedRows;
      return <div className="min-w-0" key={dataset}>
        <dt className="type-body-sm text-text-secondary">{label}</dt>
        <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <strong className="type-kpi-value tabular-nums">{count == null ? '—' : count.toLocaleString('en-MY')}</strong>
          {(count == null || count === 0) && <span className="type-body-sm text-text-secondary">{count == null ? 'Awaiting data' : 'Accepted empty'}</span>}
        </dd>
      </div>;
    })}
  </dl>;
}

function ConnectionGlCoverage({ coverage }) {
  const bounds = coverage?.configuredStartDate && coverage.expectedThrough && Number.isInteger(coverage.remainingDays);
  if (!bounds && !coverage?.acceptedDays) return <p className="type-body-sm text-text-secondary">GL coverage awaiting accepted data</p>;
  const start = bounds ? coverage.configuredStartDate : coverage.firstDate;
  const end = bounds ? coverage.expectedThrough : coverage.throughDate;
  const expected = (Date.parse(end) - Date.parse(start)) / dayMs + 1;
  const accepted = bounds ? expected - coverage.remainingDays : coverage.acceptedDays;
  const missing = expected - accepted;
  return <div className="grid gap-1.5 type-body-sm text-text-secondary">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <div className="flex flex-wrap gap-x-2"><strong className="text-text-primary">GL coverage</strong><span>{start} → {end}</span></div>
      <div className="flex flex-wrap gap-x-2 tabular-nums"><strong className="text-text-primary">{accepted}/{expected} days accepted</strong><span>{missing} missing</span></div>
    </div>
    {expected > 0 && <progress className="h-1.5 w-full overflow-hidden rounded-full accent-primary" aria-label="GL coverage" value={accepted} max={expected} />}
  </div>;
}

function bookIdentity(entry) {
  const reference = entry.connector?.bookId?.slice(0, 8);
  return [entry.legalEntityLabel, entry.connector && entry.connection.externalTenantId, reference && `Book ${reference}`].filter(Boolean).join(' · ');
}

function ConnectionCard({ entry, onAction, onBrowse, onDetails }) {
  const { connector } = entry;
  const online = autoCountOnline(entry);
  return <article className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4" aria-label={entry.providerLabel}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="grid min-w-0 gap-1">
        <h2 className="type-section-title font-semibold">{entry.providerLabel}</h2>
        <p className="type-body-sm text-text-secondary">{bookIdentity(entry)}</p>
        {connector && <AutoCountStatus entry={entry} />}
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Account Book actions">
        {onBrowse && <button type="button" className="btn-primary" onClick={() => onBrowse(entry)}>View Data</button>}
        {onAction && connector && entry.state === 'connected' && <button type="button" className="btn-secondary"
          disabled={Boolean(connector.retryRequestedAt)} onClick={() => onAction('retry', entry, { queued: !online })}>
          {connector.retryRequestedAt ? 'Sync Queued' : online ? 'Sync Now' : 'Queue Sync'}
        </button>}
        <button type="button" className="btn-secondary" aria-haspopup="dialog" onClick={() => onDetails(entry.connection.id)}>Connection Details</button>
      </div>
    </div>
    {connector && <>
      <div className="grid min-w-0 gap-3 rounded-lg bg-surface-muted px-3 py-2.5 sm:px-4">
        <BookDatasetCounts entry={entry} />
        <ConnectionGlCoverage coverage={entry.glCoverage} />
      </div>
      <AutoCountSyncSummary entry={entry} timestamp={timestamp} />
    </>}
  </article>;
}

function ConnectionDetails({ entry, device, comparisons, onAction, onClose }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [tab, setTab] = useState('Overview');
  const panelId = useId();
  const identity = [
    ['Legal entity', entry.legalEntityLabel],
    ['Account Book', entry.connection.externalTenantId],
  ].filter(([, value]) => value);
  const metadata = [
    ['Book reference', entry.connector?.bookId?.slice(0, 8)],
    ['Windows device', device?.label],
    ['Book verified', entry.connector?.verifiedAt && timestamp(entry.connector.verifiedAt)],
    ['Last source connection', entry.lastConnectedAt && timestamp(entry.lastConnectedAt)],
  ].filter(([, value]) => value);
  return <Drawer width="md" title="Connection Details" description={entry.providerLabel} onClose={onClose}
    bodyClassName="grid content-start gap-4 sm:p-5"
    footer={onAction && entry.connector ? <ActionMenu open={moreOpen} onOpenChange={setMoreOpen} ariaLabel="More Actions"
      trigger={({ toggle, open, ariaLabel }) => <button type="button" className="btn-secondary" aria-haspopup="menu"
        aria-expanded={open} aria-label={ariaLabel} onClick={toggle}>More Actions</button>}>
      <div role="menu" aria-label="More Actions">
        <button type="button" role="menuitem" className="is-danger" onClick={() => { onClose(); onAction('revoke', entry); }}>Revoke Access</button>
      </div>
    </ActionMenu> : null}>
    <AdminSegmentedControl label="Connection detail views" value={tab} onChange={setTab}
      options={detailTabs.map((label) => ({ label, value: label, panelId }))} />
    <div id={panelId} role="tabpanel" aria-label={tab} className="grid min-w-0 gap-5">
      {tab === 'Overview' && <>
        <section className="grid gap-2" aria-label="Book identity">
          <h3 className="type-section-title font-semibold">Book identity</h3>
          <ConnectionFacts facts={identity} />
          {entry.connector && <AutoCountStatus entry={entry} />}
        </section>
        <section className="grid gap-2" aria-label="Financial evidence">
          <h3 className="type-section-title font-semibold">Financial evidence</h3>
          <p className="type-body-sm text-text-secondary">{comparisons.length
            ? `${comparisons.filter((item) => item.reconciliation.status === 'reconciled').length} of ${comparisons.length} financial comparisons reconciled.`
            : 'Financial report evidence pending.'}</p>
          <p className="type-body-sm text-text-secondary">Accepted snapshots and independent dataset parity are separate checks.</p>
        </section>
      </>}
      {tab === 'Capabilities' && <section className="grid gap-2.5" aria-label="Provider capabilities">
        <h3 className="type-section-title font-semibold">Provider capabilities</h3>
        <p className="type-body-sm text-text-secondary">Observed across AutoCount connections.</p>
        <Capabilities values={entry.connection.capabilities} />
      </section>}
      {tab === 'Diagnostics' && <>
        {entry.connector && <section className="grid gap-2.5" aria-label="Sync diagnostics">
          <h3 className="type-section-title font-semibold">Sync diagnostics</h3>
          <AutoCountDiagnostics entry={entry} timestamp={timestamp} />
        </section>}
        {metadata.length > 0 && <section className="grid gap-2" aria-label="Connection metadata">
          <h3 className="type-section-title font-semibold">Connection metadata</h3>
          <ConnectionFacts facts={metadata} />
        </section>}
      </>}
    </div>
  </Drawer>;
}

function ConnectionFacts({ facts }) {
  return <dl className="grid grid-cols-2 gap-3 type-body-sm">
    {facts.map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-text-secondary">{label}</dt><dd className="mt-0.5 break-words font-medium">{value}</dd></div>)}
  </dl>;
}

function HistoricalConnection({ entry }) {
  return <li className="grid gap-1 py-2 type-body-sm">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-semibold text-text-primary">{entry.providerLabel}</h3>
      <StatusBadge status="neutral">{entry.supersededByConnectionId ? 'Superseded' : 'Historical'}</StatusBadge>
    </div>
    <p>{bookIdentity(entry)}</p>
    {entry.connector && <p>Last successful sync · {timestamp(entry.connector.lastSyncAt)}</p>}
    {entry.datasets?.length > 0 && <p>{entry.datasets.map((item) => `${item.dataset} · ${item.acceptedRows} accepted rows`).join(' · ')}</p>}
  </li>;
}

function canBrowseAccounting(entry) {
  return entry.status === 'active' && entry.state === 'connected' && Boolean(entry.connector);
}
function ConnectionSection({ state, onAction, onBrowse, onDetails }) {
  const { operational, historical } = partitionAccountingConnections(state.connections);
  const showDevices = onAction && state.connectorDevices?.length > 0;
  return <div className="grid min-w-0 gap-3">
    {!operational.length && <p className="type-body-sm text-text-secondary">No accounting provider connected</p>}
    {operational.map((entry) => <ConnectionCard key={entry.connection.id} entry={entry} onAction={onAction} onDetails={onDetails}
      onBrowse={onBrowse && canBrowseAccounting(entry) ? onBrowse : undefined} />)}
    {showDevices && <AdminEvidenceDisclosure label="Windows Devices" variant="accordion">
      <AutoCountDevices state={state} onAction={onAction} />
    </AdminEvidenceDisclosure>}
    {historical.length > 0 && <AdminEvidenceDisclosure label="Historical Connections" variant="accordion">
      <ul className="divide-y divide-border">{historical.map((entry) => <HistoricalConnection key={entry.connection.id} entry={entry} />)}</ul>
    </AdminEvidenceDisclosure>}
  </div>;
}

function SourceSectionHeading({ title, action, children }) {
  return <header className="flex flex-wrap items-start justify-between gap-2">
    <div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2>{children}</div>
    {action}
  </header>;
}
function AuthoritySection({ state, onViewConnections }) {
  return <section aria-label="Source authority" className="grid gap-3">
    <SourceSectionHeading title="Accounting authority periods" action={<button type="button" className="btn-secondary" onClick={onViewConnections}>Review source connections</button>}>
      <p className="mt-0.5 type-body-sm text-text-secondary">{state.operationalSource.label} owns the operational P&L. Authority is assigned by legal entity, resource and period.</p>
    </SourceSectionHeading>
    {!state.authorityPeriods.length ? <p className="type-body-sm text-text-secondary">No accounting authority periods</p> : <div className="overflow-x-auto"><table className="finance-source-table"><caption className="sr-only">Historical and active accounting authority periods</caption><thead><tr><th>Source</th><th>Legal entity</th><th>Evidence</th><th>Effective period</th><th>Provider status</th></tr></thead><tbody>{state.authorityPeriods.map((period) => {
      const entry = state.connections.find((connection) => connection.connection.id === period.connectionId);
      return <tr key={`${period.connectionId}:${period.resource}:${period.start}`}><td>{entry?.providerLabel ?? 'Source unavailable'}</td><td>{entry?.legalEntityLabel ?? 'Binding unavailable'}</td><td>{period.resource}</td><td>{periodLabel(period)}</td><td>{entry?.status === 'historical' ? 'Historical' : entry?.status === 'active' ? 'Active' : 'Unknown'}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
function MappingSection({ state, onBrowse, mappingConnectionId, onSelectMappingSource, onMappingSaved }) {
  const sources = state.connections.filter(canBrowseAccounting);
  const selected = sources.find((entry) => entry.connection.id === mappingConnectionId) ?? sources[0];
  const revision = selected?.accountMapping && [selected.mappingSnapshotId, selected.accountMapping.confirmed, selected.accountMapping.changed,
    selected.accountMapping.unresolved, selected.accountMapping.removed].join(':');
  return <section aria-label="Mapping readiness" className="grid gap-3">
    <SourceSectionHeading title="Account mapping" action={onBrowse && selected && <button type="button" className="btn-secondary" onClick={() => onBrowse(selected, 'COA')}>Browse source accounts</button>}>
      {selected && sources.length === 1 && <p className="mt-0.5 type-body-sm text-text-secondary">{bookIdentity(selected)}</p>}
    </SourceSectionHeading>
    {sources.length > 1 && <label className="grid w-fit gap-1 type-body-sm">Account Book
      <select className="control" value={selected.connection.id} onChange={(event) => onSelectMappingSource(event.target.value)}>
        {sources.map((entry) => <option key={entry.connection.id} value={entry.connection.id}>
          {entry.legalEntityLabel} · {entry.connection.externalTenantId} · {entry.connector.bookId?.slice(0, 8)}
        </option>)}
      </select>
    </label>}
    {selected && onBrowse && <FinanceAccountMapping key={selected.connection.id} connectionId={selected.connection.id}
      revision={revision} timestamp={timestamp} onChange={onMappingSaved} />}
    {selected && <ul className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-text-secondary" aria-label="Dimension evidence">
      {['Department', 'Project'].map((dataset) => {
        const accepted = selected.datasets?.find((entry) => entry.dataset === dataset);
        const status = accepted ? (accepted.acceptedRows ? `${accepted.acceptedRows} accepted · Mapping not assessed` : 'Accepted dataset is empty')
          : selected.connection.capabilities.financial_dimensions === 'unsupported' ? 'Unsupported by source' : 'No accepted evidence';
        return <li key={dataset}>{dataset} · {status}</li>;
      })}
    </ul>}
    <ul className="divide-y divide-border">{Object.entries(mappingLabels).filter(([kind]) => !selected || kind !== 'account').map(([kind, label]) => {
      const evidence = state.mappingReadiness.filter((entry) => entry.kind === kind && (!selected || selected.connection.id === entry.connectionId));
      return <li key={kind} className="flex flex-wrap items-start justify-between gap-2 py-2">
        <h3 className="type-body-sm font-medium">{label}</h3>
        {!evidence.length ? <span className="type-caption text-text-secondary">Not assessed</span> : <ul className="type-caption text-text-secondary">{evidence.map((entry) => {
          const connection = state.connections.find((source) => source.connection.id === entry.connectionId);
          return <li key={`${entry.connectionId}:${entry.scope.kind}:${entry.scope.id}:${entry.period.start}`}><strong>{entry.mapped} mapped · {entry.unresolved} unresolved</strong><p>{connection?.providerLabel ?? 'Source unavailable'} · {entry.scopeLabel ?? entry.scope.kind.replaceAll('_', ' ')} · {periodLabel(entry.period)}</p></li>;
        })}</ul>}
      </li>;
    })}</ul>
  </section>;
}
function ReconciliationSection({ state, onViewConnections }) {
  const hasAedTest = state.connections.some((entry) =>
    entry.connector?.bookId === '3037f4f7-94e6-4050-a6c0-a790559fb056' && canBrowseAccounting(entry));
  return <section aria-label="Financial reconciliation" className="grid gap-3">
    <SourceSectionHeading title="Validated comparisons" action={<button type="button" className="btn-secondary" onClick={onViewConnections}>Review accepted evidence</button>} />
    {!state.reconciliations.length ? <p className="type-body-sm text-text-secondary">No validated reconciliation evidence. Compare accounting reports for the same book, period and scope.</p> : <div className="overflow-x-auto"><table className="finance-source-table"><caption className="sr-only">Validated financial comparisons</caption><thead><tr><th>Period</th><th>Source</th><th>Metric / balance</th><th>Difference</th><th>State</th></tr></thead><tbody>{state.reconciliations.map((entry, index) => <tr key={`${entry.connectionId}:${entry.metricId}:${index}`}><td>{periodLabel(entry.period)}</td><td>{entry.sourceLabel}</td><td>{metricRegistry[entry.metricId]?.label ?? entry.metricId}</td><td>{difference(entry)}</td><td>{entry.reconciliation.status}</td></tr>)}</tbody></table></div>}
    {hasAedTest && <FinanceDisclosure label="AED_TEST accounting evidence">
      <div className="grid justify-items-start gap-2">
        <p className="type-caption text-text-secondary">Capture the office SQL catalog and compare it with matching AutoCount Desktop exports.</p>
        <a className="btn-secondary" href="/downloads/FeedX-AED_TEST-Accounting-Evidence.ps1" download>Download read-only evidence capture</a>
      </div>
    </FinanceDisclosure>}
  </section>;
}
const panels = { Connection: ConnectionSection, Authority: AuthoritySection, Mapping: MappingSection, Reconciliation: ReconciliationSection };

export function FinanceDataSources({ state, onAction, onMappingSaved }) {
  const [section, setSection] = useState('Connection');
  const [browse, setBrowse] = useState(null);
  const [detailsId, setDetailsId] = useState(null);
  const [mappingConnectionId, setMappingConnectionId] = useState(null);
  const panelId = useId();
  const summary = dataSourceReadiness(state).summary.slice(0, 4);
  const Panel = panels[section];
  const activeBrowse = browse && state.connections.find((entry) => entry.connection.id === browse.connectionId && canBrowseAccounting(entry));
  const detailEntry = detailsId && state.connections.find((entry) => entry.connection.id === detailsId && entry.status === 'active');
  const detailDevice = detailEntry?.connector?.bookId && state.connectorDevices?.find((device) =>
    device.books.some((book) => book.id === detailEntry.connector.bookId));
  const openBrowser = onAction ? (entry, dataset) => setBrowse({ connectionId: entry.connection.id, dataset }) : undefined;
  function changeSection(value) {
    setMappingConnectionId(null);
    setSection(value);
  }
  return <div className="grid min-w-0 gap-4">
    <section aria-label="Data readiness" className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1 sm:grid-cols-4 sm:gap-2 sm:p-2">
      {summary.map((item, index) => <button key={item.label} type="button" onClick={() => changeSection(sections[index])}
        className="group grid min-w-0 content-start gap-1 rounded-lg p-2.5 text-left hover:bg-surface-muted focus-visible:outline-primary sm:px-3">
        <span className="flex items-center justify-between gap-1 type-body-sm font-medium text-text-secondary">{item.label}<ArrowRight size={14} className="shrink-0 group-hover:text-primary-ink" aria-hidden="true" /></span>
        <strong className="type-section-title font-semibold">{item.value}</strong>
        {index === 2 && state.connections.some((entry) => entry.accountMapping) && <span className="type-body-sm text-text-secondary">{item.detail}</span>}
      </button>)}
    </section>
    <AdminSegmentedControl label="Data source concerns" value={section} onChange={changeSection}
      options={sections.map((label) => ({ label, value: label, panelId }))} />
    <div id={panelId} role="tabpanel" aria-label={section} className="min-w-0">
      <Panel state={state} onAction={onAction} onBrowse={openBrowser} onDetails={setDetailsId}
        mappingConnectionId={mappingConnectionId} onSelectMappingSource={setMappingConnectionId} onMappingSaved={onMappingSaved}
        onViewConnections={() => changeSection('Connection')} />
    </div>
    {detailEntry && <ConnectionDetails entry={detailEntry} device={detailDevice}
      comparisons={state.reconciliations.filter((item) => item.connectionId === detailEntry.connection.id)}
      onAction={onAction} onClose={() => setDetailsId(null)} />}
    {activeBrowse && <AccountingDatasetBrowser key={activeBrowse.connection.id} connection={activeBrowse} initialDataset={browse.dataset} timestamp={timestamp}
      onClose={() => setBrowse(null)} onReviewMapping={() => { setMappingConnectionId(activeBrowse.connection.id); setBrowse(null); setSection('Mapping'); }} />}
  </div>;
}

function LiveFinanceDataSourcesPage() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState('');
  const canManage = Array.isArray(state?.connectorEntities);
  useEffect(() => {
    if (!canManage) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setAttempt((value) => value + 1);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [canManage]);
  function onSaved(action) {
    setModal(null);
    setNotice({ pair: 'Computer paired. Use Test Connection in Windows to send its authorized books now, or wait for the next background check.', bind: 'Account Book connected. Waiting for the Windows Connector to verify the book.', retry: 'Sync queued for the next eligible check-in.', revoke: 'Book access revoked.', revoke_device: 'Computer access revoked.' }[action]);
    setAttempt((value) => value + 1);
  }
  useEffect(() => {
    let active = true;
    setError('');
    readFinanceDataSources().then((next) => { if (active) setState(next); }).catch(() => { if (active) setError('Financial source status could not be loaded.'); });
    return () => { active = false; };
  }, [attempt]);
  return <WorkspacePage className="finance-workspace" section="Finance · Manage" title="Data Sources" density="compact" description="Manage accounting sources, mappings and reconciliation." actions={<button type="button" className="btn-secondary" disabled={!canManage || !state.connectorEntities.length} onClick={() => setModal({ action: 'pair' })}><Link2 size={15} />Connect provider</button>}>
    {notice && <p role="status" className="type-body-sm text-text-secondary">{notice}</p>}
    <AsyncDataSurface loading={!state && !error} error={error} hasData={Boolean(state)} onRetry={() => setAttempt((value) => value + 1)}>{state ? <FinanceDataSources state={state} onMappingSaved={(connectionId, accountMapping) => setState((current) => ({
      ...current, connections: current.connections.map((entry) => entry.connection.id === connectionId ? { ...entry, accountMapping } : entry),
    }))} onAction={canManage ? (action, entry, details) => setModal({ action, entry, ...details }) : undefined} /> : null}</AsyncDataSurface>
    {modal && <AutoCountActionModal {...modal} entities={state.connectorEntities} onClose={() => { setModal(null); setAttempt((value) => value + 1); }} onSaved={onSaved} />}
  </WorkspacePage>;
}

export default function FinanceDataSourcesPage(props) { return <FinancePreviewBoundary auth={props.auth} section="data_sources"><LiveFinanceDataSourcesPage /></FinancePreviewBoundary>; }
