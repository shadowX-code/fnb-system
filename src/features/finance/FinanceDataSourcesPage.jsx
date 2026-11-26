import FinanceAnalysisSurface from './FinanceAnalysisSurface.jsx';
import ActionMenu from '../../components/ui/ActionMenu.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import FinancePreviewBoundary from './FinancePreviewBoundary.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { money } from '../reports/components/reportingFormatters.js';
import { metricRegistry } from './metrics.js';
import { dataSourceReadiness, mappingLabels, partitionAccountingConnections, readFinanceDataSources } from './dataSources.js';
import { AutoCountActionModal, AutoCountDevices, AutoCountStatus, autoCountOnline } from './AutoCountConnector.jsx';
import FinanceAccountMapping from './FinanceAccountMapping.jsx';
import AccountingDatasetBrowser from './AccountingDatasetBrowser.jsx';
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
const capabilityStateLabels = { supported: 'Supported', partial: 'Observed in FeedX', unverified: 'Unverified', unsupported: 'Unsupported' };
const datasetNames = ['COA', 'GL', 'Department', 'Project'];
const dayMs = 24 * 60 * 60 * 1000;

function Capabilities({ values }) {
  return <dl className="finance-source-facts">{Object.entries(values).map(([id, state]) => <div key={id}>
    <dt>{capabilityLabels[id] ?? id}</dt><dd>{capabilityStateLabels[state] ?? state}</dd>
  </div>)}</dl>;
}

function BookDatasetCounts({ entry }) {
  return <dl aria-label="Book dataset acceptance" className="flex flex-wrap gap-x-4 gap-y-1 type-caption">
    {datasetNames.map((dataset) => {
      const snapshot = entry.datasets?.find((item) => item.dataset === dataset);
      const count = dataset === 'GL' && entry.glCoverage?.acceptedDays ? entry.glCoverage.acceptedRows : snapshot?.acceptedRows;
      return <div className="flex items-baseline gap-1" key={dataset}>
        <dt className="text-text-secondary">{dataset}</dt>
        <dd className="font-semibold">{count == null ? 'Awaiting data' : count === 0 ? '0 (empty)' : count.toLocaleString('en-MY')}</dd>
      </div>;
    })}
  </dl>;
}

function ConnectionGlCoverage({ coverage }) {
  const bounds = coverage?.configuredStartDate && coverage.expectedThrough && Number.isInteger(coverage.remainingDays);
  if (!bounds && !coverage?.acceptedDays) return <p className="type-caption text-text-secondary">GL coverage awaiting accepted data</p>;
  const start = bounds ? coverage.configuredStartDate : coverage.firstDate;
  const end = bounds ? coverage.expectedThrough : coverage.throughDate;
  const expected = (Date.parse(end) - Date.parse(start)) / dayMs + 1;
  const accepted = bounds ? expected - coverage.remainingDays : coverage.acceptedDays;
  const missing = expected - accepted;
  return <p className="flex flex-wrap gap-x-2 type-caption text-text-secondary">
    <strong className="text-text-primary">GL coverage</strong>
    <span>{start} → {end}</span><span>{accepted}/{expected} days accepted</span><span>{missing} missing</span>
  </p>;
}

function ConnectionCard({ entry, onAction, onBrowse, comparisons = [] }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const historical = entry.status === 'historical';
  const connector = entry.connector;
  const online = autoCountOnline(entry);
  const reference = connector?.bookId?.slice(0, 8);
  const label = [entry.legalEntityLabel, connector && entry.connection.externalTenantId, reference && `Book ${reference}`].filter(Boolean).join(' · ');
  return <article className="grid min-w-0 gap-2 rounded-lg border border-border px-3 py-2.5 sm:px-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 className="type-body-sm font-semibold">{entry.providerLabel}</h3><p className="type-caption text-text-secondary">{label}</p></div>
      {historical ? <StatusBadge status="neutral">{entry.supersededByConnectionId ? 'Superseded' : 'Historical'}</StatusBadge>
        : <div className="flex flex-wrap items-center gap-1.5" aria-label="Account Book actions">
          {onAction && connector && entry.state === 'connected' && <button type="button" className="btn-primary"
            disabled={Boolean(connector.retryRequestedAt)} onClick={() => onAction('retry', entry, { queued: !online })}>
            {connector.retryRequestedAt ? 'Sync Queued' : online ? 'Sync Now' : 'Queue Sync'}
          </button>}
          {onBrowse && <button type="button" className="btn-secondary" onClick={() => onBrowse(entry)}>View Data</button>}
          {onAction && connector && <ActionMenu open={moreOpen} onOpenChange={setMoreOpen} ariaLabel="More Actions"
            trigger={({ toggle, open, ariaLabel }) => <button type="button" className="btn-secondary" aria-haspopup="menu"
              aria-expanded={open} aria-label={ariaLabel} onClick={toggle}>More Actions</button>}>
            <div role="menu" aria-label="More Actions">
              <button type="button" role="menuitem" className="is-danger"
                onClick={() => { setMoreOpen(false); onAction('revoke', entry); }}>Revoke Access</button>
            </div>
          </ActionMenu>}
        </div>}
    </div>
    {historical && connector && <p className="type-caption text-text-secondary">Last successful sync · {timestamp(connector.lastSyncAt)}</p>}
    {historical && entry.datasets?.length > 0 && <ul aria-label="Accepted accounting evidence" className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-text-secondary">
      {entry.datasets.map((item) => <li key={item.dataset}>{item.dataset} · {item.acceptedRows} accepted rows</li>)}
    </ul>}
    {!historical && connector && <>
      <BookDatasetCounts entry={entry} />
      <ConnectionGlCoverage coverage={entry.glCoverage} />
      <AutoCountStatus entry={entry} timestamp={timestamp}>
        <FinanceDisclosure label="Provider capabilities">
          <p className="type-caption text-text-secondary">Observed across AutoCount connections. This book’s counts show accepted snapshots.</p>
          <Capabilities values={entry.connection.capabilities} />
          <p className="type-caption text-text-secondary">
            Independent dataset parity is recorded separately from upload acceptance.
            {' '}{comparisons.length ? `${comparisons.filter((item) => item.reconciliation.status === 'reconciled').length} of ${comparisons.length} financial comparisons reconciled.` : 'Financial report evidence pending.'}
          </p>
        </FinanceDisclosure>
      </AutoCountStatus>
    </>}
    {!historical && !connector && <FinanceDisclosure label="Provider capabilities"><Capabilities values={entry.connection.capabilities} /></FinanceDisclosure>}
  </article>;
}
function canBrowseAccounting(entry) {
  return entry.status === 'active' && entry.state === 'connected' && Boolean(entry.connector);
}
function ConnectionSection({ state, onAction, onBrowse }) {
  const { operational, historical } = partitionAccountingConnections(state.connections);
  return <section aria-label="Accounting connections" className="grid gap-2">
    <h2 className="type-body-sm font-semibold">Accounting connections</h2>
    {!operational.length && <p className="type-body-sm text-text-secondary">No accounting provider connected</p>}
    {operational.map((entry) => <ConnectionCard key={entry.connection.id} entry={entry} onAction={onAction}
      comparisons={state.reconciliations.filter((item) => item.connectionId === entry.connection.id)}
      onBrowse={onBrowse && canBrowseAccounting(entry) ? onBrowse : undefined} />)}
    {onAction && state.connectorDevices?.length > 0 && <FinanceDisclosure label="Windows devices">
      <AutoCountDevices state={state} onAction={onAction} />
    </FinanceDisclosure>}
    {historical.length > 0 && <FinanceDisclosure label="Connection History">
      {historical.map((entry) => <ConnectionCard key={entry.connection.id} entry={entry} />)}
    </FinanceDisclosure>}
  </section>;
}
function AuthoritySection({ state, onViewConnections }) {
  return <section aria-label="Source authority" className="grid gap-2">
    <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="type-body-sm font-semibold">Accounting authority periods</h2><button type="button" className="btn-secondary" onClick={onViewConnections}>Review source connections</button></div>
    <p className="type-caption text-text-secondary">{state.operationalSource.label} owns the operational P&L. Accounting authority is assigned per legal entity, resource and period.</p>
    {!state.authorityPeriods.length ? <p className="type-body-sm text-text-secondary">No accounting authority periods</p> : <div className="finance-source-table-wrap"><table className="finance-source-table"><caption className="sr-only">Historical and active accounting authority periods</caption><thead><tr><th>Source</th><th>Legal entity</th><th>Evidence</th><th>Effective period</th><th>Provider status</th></tr></thead><tbody>{state.authorityPeriods.map((period) => {
      const entry = state.connections.find((connection) => connection.connection.id === period.connectionId);
      return <tr key={`${period.connectionId}:${period.resource}:${period.start}`}><td>{entry?.providerLabel ?? 'Source unavailable'}</td><td>{entry?.legalEntityLabel ?? 'Binding unavailable'}</td><td>{period.resource}</td><td>{periodLabel(period)}</td><td>{entry?.status === 'historical' ? 'Historical' : entry?.status === 'active' ? 'Active' : 'Unknown'}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}
function MappingSection({ state, onBrowse, mappingConnectionId, onSelectMappingSource, onMappingSaved }) {
  const sources = state.connections.filter(canBrowseAccounting);
  const selected = sources.find((entry) => entry.connection.id === mappingConnectionId) ?? sources[0];
  return <section aria-label="Mapping readiness" className="grid gap-2">
    <h2 className="type-body-sm font-semibold">Classification and dimension mapping</h2>
    {sources.length > 1 && <label className="grid w-fit gap-1 type-caption">Account Book
      <select className="control" value={selected.connection.id} onChange={(event) => onSelectMappingSource(event.target.value)}>
        {sources.map((entry) => <option key={entry.connection.id} value={entry.connection.id}>
          {entry.legalEntityLabel} · {entry.connection.externalTenantId} · {entry.connector.bookId?.slice(0, 8)}
        </option>)}
      </select>
    </label>}
    {selected && <p className="type-caption text-text-secondary">Selected source · {selected.connection.externalTenantId} · Book {selected.connector.bookId?.slice(0, 8)}</p>}
    {onBrowse && sources.length > 0 && <div className="flex flex-wrap gap-2">
      {(selected ? [selected] : sources).map((entry) => <button key={entry.connection.id} type="button" className="btn-secondary" onClick={() => onBrowse(entry, 'COA')}>
        Browse source accounts{sources.length > 1 ? ` · ${entry.legalEntityLabel}` : ''}
      </button>)}
    </div>}
    {selected && onBrowse && <FinanceAccountMapping key={selected.connection.id} connectionId={selected.connection.id} timestamp={timestamp} onChange={onMappingSaved} />}
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
  return <section aria-label="Financial reconciliation" className="grid gap-2"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="type-body-sm font-semibold">Validated comparisons</h2><button type="button" className="btn-secondary" onClick={onViewConnections}>Review accepted evidence</button></div>
    {!state.reconciliations.length ? <p className="type-body-sm text-text-secondary">No validated reconciliation evidence. Accounting reports need matching AutoCount Desktop evidence for this source, period and scope.</p> : <div className="finance-source-table-wrap"><table className="finance-source-table"><caption className="sr-only">Validated financial comparisons</caption><thead><tr><th>Period</th><th>Source</th><th>Metric / balance</th><th>Difference</th><th>State</th></tr></thead><tbody>{state.reconciliations.map((entry, index) => <tr key={`${entry.connectionId}:${entry.metricId}:${index}`}><td>{periodLabel(entry.period)}</td><td>{entry.sourceLabel}</td><td>{metricRegistry[entry.metricId]?.label ?? entry.metricId}</td><td>{difference(entry)}</td><td>{entry.reconciliation.status}</td></tr>)}</tbody></table></div>}
    {hasAedTest && <FinanceDisclosure label="AED_TEST accounting evidence">
      <div className="grid justify-items-start gap-2">
        <p className="type-caption text-text-secondary">The office assessment checks which AutoCount SQL objects the local book exposes. Compare those findings with Desktop exports for Trial Balance, Profit &amp; Loss, Balance Sheet, account balances, aging and inventory valuation.</p>
        <a className="btn-secondary" href="/downloads/FeedX-AED_TEST-Accounting-Evidence.ps1" download>Download read-only evidence capture</a>
      </div>
    </FinanceDisclosure>}
  </section>;
}
export function FinanceDataSources({ state, onAction, onMappingSaved }) {
  const [section, setSection] = useState('Connection');
  const [browse, setBrowse] = useState(null);
  const [mappingConnectionId, setMappingConnectionId] = useState(null);
  const ready = dataSourceReadiness(state);
  const panels = { Connection: ConnectionSection, Authority: AuthoritySection, Mapping: MappingSection, Reconciliation: ReconciliationSection };
  const Panel = panels[section];
  const activeBrowse = browse && state.connections.find((entry) => entry.connection.id === browse.connectionId && canBrowseAccounting(entry));
  const openBrowser = onAction ? (entry, dataset) => setBrowse({ connectionId: entry.connection.id, dataset }) : undefined;
  return <div className="grid min-w-0 gap-3">
    <dl aria-label="Data health" className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-4 py-2 sm:grid-cols-4">
      {ready.summary.slice(0, 4).map((item) => <div key={item.label}><dt className="type-caption text-text-secondary">{item.label}</dt><dd className="type-body-sm font-semibold">{item.value}</dd>
        {item.label === 'Mapping readiness' && state.connections.some((entry) => entry.accountMapping) && <dd className="type-caption text-text-secondary">{item.detail}</dd>}</div>)}
    </dl>
    <FinanceAnalysisSurface label="Data source concerns" title="Source management" modes={sections} value={section} onChange={(value) => { setMappingConnectionId(null); setSection(value); }}>
      <Panel state={state} onAction={onAction} onBrowse={openBrowser} mappingConnectionId={mappingConnectionId} onSelectMappingSource={setMappingConnectionId} onMappingSaved={onMappingSaved} onViewConnections={() => setSection('Connection')} />
    </FinanceAnalysisSurface>
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
  return <WorkspacePage className="finance-workspace" section="Finance · Manage" title="Data Sources" description="Manage where financial evidence comes from and whether it is usable." actions={<button type="button" className="btn-secondary" disabled={!canManage || !state.connectorEntities.length} onClick={() => setModal({ action: 'pair' })}><Link2 size={15} />Connect provider</button>}>
    {notice && <p role="status" className="type-body-sm text-text-secondary">{notice}</p>}
    <AsyncDataSurface loading={!state && !error} error={error} hasData={Boolean(state)} onRetry={() => setAttempt((value) => value + 1)}>{state ? <FinanceDataSources state={state} onMappingSaved={(connectionId, accountMapping) => setState((current) => ({
      ...current, connections: current.connections.map((entry) => entry.connection.id === connectionId ? { ...entry, accountMapping } : entry),
    }))} onAction={canManage ? (action, entry, details) => setModal({ action, entry, ...details }) : undefined} /> : null}</AsyncDataSurface>
    {modal && <AutoCountActionModal {...modal} entities={state.connectorEntities} onClose={() => { setModal(null); setAttempt((value) => value + 1); }} onSaved={onSaved} />}
  </WorkspacePage>;
}

export default function FinanceDataSourcesPage(props) { return <FinancePreviewBoundary auth={props.auth} section="data_sources"><LiveFinanceDataSourcesPage /></FinancePreviewBoundary>; }
