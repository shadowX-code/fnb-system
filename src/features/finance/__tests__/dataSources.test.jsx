// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FinanceDataSourcesPage, { FinanceDataSources } from '../FinanceDataSourcesPage.jsx';
import { dataSourceReadiness, overviewDataStatus, readFinanceDataSources } from '../dataSources.js';
import { capabilities } from '../foundation.js';
import * as financeSources from '../dataSources.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const period = { start: '2026-01-01', end: '2026-12-31' };
function historicalState() {
  return {
    operationalSource: { providerId: 'feedx', label: 'FeedX Reporting', capabilities: capabilities() },
    connections: ['old', 'new'].map((id) => ({
      connection: { id, providerId: id, legalEntityId: 'entity', currency: 'MYR', capabilities: capabilities() },
      providerLabel: id === 'old' ? 'Prior accounting source' : 'Current accounting source', legalEntityLabel: 'Restaurant entity',
      state: id === 'old' ? 'deactivated' : 'connected', status: id === 'old' ? 'historical' : 'active', sync: [],
    })),
    authorityPeriods: [
      { connectionId: 'old', legalEntityId: 'entity', resource: 'balances', start: period.start, end: '2026-06-30' },
      { connectionId: 'new', legalEntityId: 'entity', resource: 'balances', start: '2026-07-01', end: period.end },
    ],
    mappingReadiness: [{ connectionId: 'new', kind: 'account', scope: { kind: 'legal_entity', id: 'entity' }, scopeLabel: 'Restaurant entity', period, mapped: 12, unresolved: 3 }],
    reconciliations: [],
  };
}
it('keeps the current management read honest with no connected accounting evidence', async () => {
  const state = await readFinanceDataSources();
  const readiness = dataSourceReadiness(state);
  expect(state.connections).toEqual([]);
  expect(readiness.summary.map((item) => item.value)).toEqual(['Not connected', 'Not assigned', 'Not assessed', 'Not assessed', 'Assessment incomplete']);
  render(<FinanceDataSources state={state} />);
  expect(screen.getByText('No accounting provider connected')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
  expect(within(screen.getByRole('region', { name: 'Mapping readiness' })).getAllByText('Not assessed')).toHaveLength(4);
  expect(screen.queryByText(/0 mapped/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Reconciliation' }));
  expect(screen.getByText(/No validated reconciliation evidence/)).toBeTruthy();
});
it('exposes a disabled connection boundary with no mutation action', async () => {
  render(<FinanceDataSourcesPage />);
  expect((await screen.findByRole('button', { name: 'Connect provider' })).disabled).toBe(true);
  expect(await screen.findByText('No accounting provider connected')).toBeTruthy();
});
it('retains historical connections and their original effective periods', () => {
  const state = historicalState();
  const request = { legalEntityId: 'entity', resource: 'balances', period };
  expect(dataSourceReadiness(state).coverage).toBeNull();
  expect(dataSourceReadiness(state, request).coverage.segments.map((entry) => entry.connectionId)).toEqual(['old', 'new']);
  expect(dataSourceReadiness(state, request).coverage.gaps).toEqual([]);
  state.authorityPeriods[1].start = '2026-08-01';
  expect(dataSourceReadiness(state, request).coverage.gaps).toEqual([{ start: '2026-07-01', end: '2026-07-31' }]);
  render(<FinanceDataSources state={state} />);
  const history = screen.getByText('Connection History', { selector: 'summary' }).closest('details');
  expect(history.open).toBe(false);
  expect(within(history).getByRole('heading', { name: 'Prior accounting source' })).toBeTruthy();
  expect(within(history).getByText('Historical')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sync accounting data' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Authority' }));
  expect(screen.getByRole('cell', { name: 'Historical' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: '2026-01-01 → 2026-06-30' })).toBeTruthy();
});
it('shows actual mapping counts and preserves currency, missing differences and ratio units', () => {
  const state = historicalState();
  state.reconciliations = [
    { connectionId: 'new', sourceLabel: 'Current source', metricId: 'cash', scope: { kind: 'legal_entity', id: 'entity' }, period, currency: 'USD', difference: 25, reconciliation: { status: 'unreconciled', evidence: [], checkedAt: null } },
    { connectionId: 'old', sourceLabel: 'Prior source', metricId: 'cash', period, currency: 'MYR', difference: null, reconciliation: { status: 'unverified', evidence: [], checkedAt: null } },
    { connectionId: 'new', sourceLabel: 'Current source', metricId: 'gross_margin', period, currency: 'MYR', difference: 1.25, reconciliation: { status: 'unreconciled', evidence: [], checkedAt: null } },
  ];
  render(<FinanceDataSources state={state} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
  expect(screen.getByText('12 mapped · 3 unresolved')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Mapping readiness' })).getAllByText('Not assessed')).toHaveLength(3);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Mapping' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Reconciliation' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('cell', { name: /25.00/ }).textContent).toContain('US$');
  expect(screen.getByRole('cell', { name: '—' })).toBeTruthy();
  expect(screen.getByRole('cell', { name: '1.3 pp' })).toBeTruthy();
});
it('rejects invented or invalid mapping counts', () => {
  const state = historicalState();
  for (const value of [null, -1, 0.5, NaN]) {
    state.mappingReadiness[0].mapped = value;
    expect(() => dataSourceReadiness(state)).toThrow('Invalid mapping readiness evidence');
  }
});
it('uses source evidence time rather than read time and keeps missing freshness explicit', () => {
  const provenance = (evidenceAt) => [{ semantic: 'OPERATIONAL', evidenceAt, observedAt: '2026-10-07T00:00:00Z' }];
  const dataset = { sourceLabel: 'FeedX Reporting', demo: false, metrics: {
    revenue: { value: 10, completeness: 'complete', provenance: provenance('2026-10-05T12:00:00+08:00') },
    cogs: { value: 2, completeness: 'partial', provenance: provenance('2026-10-05T05:00:00Z') },
    cash: { value: null, completeness: 'unavailable', provenance: [] },
  }};
  expect(overviewDataStatus(dataset)).toMatchObject({ evidenceAt: '2026-10-05T12:00:00+08:00', available: 2, total: 3, completeness: 'Partial / unavailable' });
  dataset.metrics.cogs.provenance[0].evidenceAt = null;
  expect(overviewDataStatus(dataset).evidenceAt).toBeNull();
});

it('distinguishes same-name book identities and binds only the explicitly selected book', async () => {
  const { AutoCountDevices } = await import('../AutoCountConnector.jsx');
  const selected = [];
  const old = { id: '18b35aac-1234-1234-1234-123456789012', name: 'AED_TEST', company: 'TEST COMPANY', ready: true, connectionId: 'existing' };
  const current = { id: '3037f4f7-1234-1234-1234-123456789012', name: 'AED_TEST', company: 'TEST COMPANY', ready: true };
  const state = { connections: [{ connection: { id: 'existing' }, legalEntityLabel: 'ABC Sdn Bhd', state: 'connected' }], connectorDevices: [{ id: 'device', active: true, books: [old, current] }] };
  render(<AutoCountDevices state={state} timestamp={() => 'Not reported'} onAction={(...args) => selected.push(args)} />);
  expect(screen.getByText(/Book reference: 18b35aac/)).toBeTruthy();
  expect(screen.getByText(/Book reference: 3037f4f7/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Connect book' }));
  expect(selected).toEqual([['bind', undefined, { book: current }]]);
  expect(old.connectionId).toBe('existing');
});

it('keeps paired/online, failed sync and overdue evidence independent', async () => {
  const { AutoCountStatus } = await import('../AutoCountConnector.jsx');
  const entry = { state: 'connected', connection: { externalTenantId: 'AED_TEST' }, connector: {
    deviceLastSeenAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), syncState: 'failed', syncError: 'network',
    backgroundMode: 'signed_in', lastAttemptAt: '2026-11-19T14:45:00Z', lastSyncAt: '2026-11-16T17:59:52Z',
  } };
  render(<AutoCountStatus entry={entry} timestamp={(value) => value || 'Not reported'} />);
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.queryByText('Online')).toBeNull();
  expect(screen.getByText('Offline · check-in overdue')).toBeTruthy();
  expect(screen.getByText('Sync failed')).toBeTruthy();
  expect(screen.getByText(/Requires a signed-in Windows user/)).toBeTruthy();
  expect(screen.getByText(/retries on its next background run/)).toBeTruthy();
  expect(screen.getByText('2026-11-19T14:45:00Z')).toBeTruthy();
  expect(screen.getByText(/2026-11-16T17:59:52Z/)).toBeTruthy();
});


it('keeps superseded AutoCount evidence in collapsed history with no live status or sync action', () => {
  const state = historicalState();
  const [old, current] = state.connections;
  Object.assign(old, { state: 'superseded', supersededByConnectionId: current.connection.id, connector: {
    bookId: '18b35aac-old-book', lastSyncAt: '2026-11-16T17:59:52Z',
    deviceLastSeenAt: new Date().toISOString(), syncState: 'failed', retryRequestedAt: '2026-11-17T01:54:49Z',
  }, datasets: [{ dataset: 'COA', acceptedRows: 137 }] });
  old.connection.externalTenantId = 'AED_TEST';
  current.connection.externalTenantId = 'AED_TEST';
  current.connector = { bookId: '3037f4f7-current-book', deviceLastSeenAt: new Date().toISOString(), syncState: 'succeeded' };
  const actions = [];
  render(<FinanceDataSources state={state} onAction={(...args) => actions.push(args)} />);
  expect(screen.getByText('1 active')).toBeTruthy();
  expect(dataSourceReadiness(state).summary[0].detail).toContain('1 historical');
  expect(dataSourceReadiness(state).issues.every((issue) => !issue.includes('Prior accounting source'))).toBe(true);
  const history = screen.getByText('Connection History', { selector: 'summary' }).closest('details');
  expect(history.open).toBe(false);
  expect(within(history).getByText(/18b35aac/)).toBeTruthy();
  expect(within(history).getByText(/Last successful sync/)).toBeTruthy();
  expect(within(history).getByText(/137 accepted rows/)).toBeTruthy();
  expect(within(history).queryByText(/Online|Sync failed|Sync requested/)).toBeNull();
  expect(within(history).queryByRole('button', { name: /request sync|retry sync|reconnect/i })).toBeNull();
  fireEvent.click(screen.getByText('Connection details', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Request sync', hidden: true }));
  expect(actions).toEqual([['retry', current]]);
});


it('browses accepted records with a pinned snapshot and opens Mapping for the same source', async () => {
  const state = historicalState();
  const current = state.connections[1];
  current.connector = { bookId: '3037f4f7-current' };
  current.connection.externalTenantId = 'AED_TEST';
  current.glCoverage = { firstDate: '2026-01-01', throughDate: '2026-11-24', latestPostingDate: '2026-09-30',
    acceptedDays: 327, emptyDays: 318, acceptedRows: 59, remainingDays: 1, nextMissingDate: '2026-04-23' };
  const read = vi.spyOn(financeSources, 'readAccountingDataset').mockImplementation(async ({ dataset, page, search, scopeDate }) => {
    const rows = dataset === 'COA' ? [{ key: `TEST-${page}`, description: 'Fixture account' }]
      : scopeDate === '2026-09-30' ? [{ key: 'GL-TEST', debit: '10.20' }] : [];
    return {
      snapshotId: dataset === 'COA' ? '16' : '17', snapshotAt: '2026-11-20T00:00:00Z',
      acceptedRows: dataset === 'COA' ? 123 : rows.length, filteredRows: dataset === 'COA' ? (search ? 1 : 123) : rows.length,
      rows,
    };
  });
  render(<FinanceDataSources state={state} onAction={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'View Data' }));
  expect(await screen.findByText('TEST-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('TEST-2')).toBeTruthy();
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: 'new', dataset: 'COA', snapshotId: '16', page: 2 }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search records' }), { target: { value: 'Fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('TEST-1')).toBeTruthy();
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Fixture', page: 1, snapshotId: '16' }));
  fireEvent.click(screen.getByRole('tab', { name: 'GL' }));
  expect(await screen.findByText('GL-TEST')).toBeTruthy();
  expect(screen.getByText(/59 accepted GL rows across all dates/)).toBeTruthy();
  expect(screen.getAllByText(/Backfill · 1 day.*pending · Next 2026-04-23/)).toHaveLength(2);
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ dataset: 'GL', scopeDate: '2026-09-30' }));
  fireEvent.change(screen.getByLabelText('Posting date'), { target: { value: '2026-11-24' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('The accepted extraction found no postings for this date.')).toBeTruthy();
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ dataset: 'GL', scopeDate: '2026-11-24', snapshotId: null }));
  fireEvent.click(screen.getByRole('tab', { name: 'COA' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review account mapping' }));
  expect(screen.getByRole('tab', { name: 'Mapping' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText(/Selected source.*3037f4f7/)).toBeTruthy();
});
