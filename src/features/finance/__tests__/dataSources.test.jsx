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

it('keeps book authorization, device polling and accepted evidence independent', async () => {
  const { AutoCountStatus } = await import('../AutoCountConnector.jsx');
  const entry = { state: 'connected', connection: { externalTenantId: 'AED_TEST' }, connector: {
    bookAuthorized: true, deviceLastSeenAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    syncState: 'failed', syncError: 'network', backgroundMode: 'signed_in',
    lastAttemptAt: '2026-11-19T14:45:00Z', lastSyncAt: '2026-11-16T17:59:52Z', lastDataUpdateAt: '2026-11-16T16:00:00Z',
  } };
  render(<AutoCountStatus entry={entry} timestamp={(value) => value || 'Not reported'} />);
  expect(screen.getByText('Book authorized')).toBeTruthy();
  expect(screen.getByText('Device offline')).toBeTruthy();
  expect(screen.getByText('Last sync failed')).toBeTruthy();
  expect(screen.getByText('Every 5 min while signed in')).toBeTruthy();
  expect(screen.getByText(/Sync resumes when the office PC is online/)).toBeTruthy();
  expect(screen.getByText('Accepted data updated').nextElementSibling.textContent).toBe(entry.connector.lastDataUpdateAt);
  expect(screen.getByText('Last device check-in').nextElementSibling.textContent).toBe(entry.connector.deviceLastSeenAt);
  expect(screen.getByText('Last successful sync').nextElementSibling.textContent).toBe(entry.connector.lastSyncAt);
  const diagnostics = screen.getByText('Diagnostics', { selector: 'summary' }).closest('details');
  expect(diagnostics.open).toBe(false);
  fireEvent.click(diagnostics.querySelector('summary'));
  expect(within(diagnostics).getByText(/retries on its next background run/)).toBeTruthy();
  expect(within(diagnostics).getByText(entry.connector.lastAttemptAt)).toBeTruthy();
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
  fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
  expect(actions).toEqual([['retry', current, { queued: false }]]);
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
  expect(screen.getByText(/Backfill · 1 day.*pending · Next 2026-04-23/)).toBeTruthy();
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

it('reviews suggestions and manual selections on the bound chart before saving', async () => {
  const state = historicalState();
  const current = state.connections[1];
  current.connector = { bookId: '3037f4f7-current' };
  current.connection.externalTenantId = 'AED_TEST';
  current.datasets = [{ dataset: 'Department', acceptedRows: 0 }];
  current.connection.capabilities = { financial_dimensions: 'partial' };
  const classifications = [
    { id: 'revenue', parent_id: null, statement: 'profit_loss', label: 'Revenue' },
    { id: 'assets', parent_id: null, statement: 'balance_sheet', label: 'Assets' },
  ];
  const rows = [
    { account_key: '100', source_type: 'SL', description: 'Sales', role: 'posting', status: 'suggested', suggestion: 'revenue', version: null, posted: true },
    { account_key: '200', source_type: 'CA', description: 'Assets group', role: 'group', status: 'group', suggestion: null, version: null },
    { account_key: '210', source_type: 'CA', description: 'Check source', role: 'posting', status: 'manual_review', suggestion: null, version: null },
  ];
  const summary = { total: 3, confirmed: 0, unresolved: 2, groups: 1 };
  const review = { connectionId: 'new', snapshotId: '16', snapshotAt: '2026-11-19T15:20:03Z', rows, classifications, summary };
  const read = vi.spyOn(financeSources, 'readAccountMapping').mockResolvedValue(review);
  const save = vi.spyOn(financeSources, 'confirmAccountMapping').mockResolvedValue({
    ...review, summary: { ...summary, confirmed: 2, unresolved: 0 },
    rows: rows.map((row) => row.role === 'posting' ? { ...row, status: 'confirmed', classification: row.suggestion ?? 'assets' } : row),
  });
  const saved = vi.fn();
  render(<FinanceDataSources state={state} onAction={() => {}} onMappingSaved={saved} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
  expect(await screen.findByText('3 source accounts · 0 confirmed · 2 need review · 1 group accounts')).toBeTruthy();
  expect(read).toHaveBeenCalledWith('new');
  expect(screen.getByText('Department · Accepted dataset is empty')).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Classification for 200' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Select suggestions on this page' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find accounts' }), { target: { value: 'check source' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Classification for 210' }), { target: { value: 'assets' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review selected (2)' }));
  expect(save).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: 'Confirm account classifications' });
  expect(within(dialog).getByText('Revenue')).toBeTruthy();
  expect(within(dialog).getByText('Assets')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm 2 classifications' }));
  expect(await screen.findByText('2 classifications confirmed.')).toBeTruthy();
  expect(save).toHaveBeenCalledWith('new', '16', [
    { accountKey: '100', classificationId: 'revenue', expectedVersion: null },
    { accountKey: '210', classificationId: 'assets', expectedVersion: null },
  ]);
  expect(saved).toHaveBeenCalledWith('new', { ...summary, confirmed: 2, unresolved: 0 });
});


it('queues offline sync and distinguishes accepted empty datasets from pending evidence', () => {
  const state = historicalState();
  const current = state.connections[1];
  current.connector = { lastSyncAt: '2026-11-18T16:00:00Z', backgroundMode: 'signed_in', pendingRetries: 0 };
  current.datasets = [{ dataset: 'COA', acceptedRows: 123 }, { dataset: 'GL', acceptedRows: 0 }, { dataset: 'Department', acceptedRows: 0 }];
  current.glCoverage = {
    configuredStartDate: '2026-11-01', expectedThrough: '2026-11-05',
    acceptedDays: 3, acceptedRows: 59, missingDays: 0, remainingDays: 2,
  };
  const onAction = vi.fn();
  render(<FinanceDataSources state={state} onAction={onAction} />);
  const acceptance = screen.getByLabelText('Book dataset acceptance');
  expect(within(acceptance).getByText('123')).toBeTruthy();
  expect(within(acceptance).getByText('59')).toBeTruthy();
  expect(within(acceptance).getByText('0 (empty)')).toBeTruthy();
  expect(within(acceptance).getByText('Awaiting data')).toBeTruthy();
  expect(screen.getByText('3/5 days accepted')).toBeTruthy();
  expect(screen.getByText('2 missing')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Queue Sync' }));
  expect(onAction).toHaveBeenCalledWith('retry', current, { queued: true });
  expect(screen.queryByRole('menuitem', { name: 'Revoke Access' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke Access' }));
  expect(onAction).toHaveBeenCalledWith('revoke', current);
});
