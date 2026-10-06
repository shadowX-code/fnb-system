// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import FinanceDataSourcesPage, { FinanceDataSources } from '../FinanceDataSourcesPage.jsx';
import { dataSourceReadiness, overviewDataStatus, readFinanceDataSources } from '../dataSources.js';
import { capabilities } from '../foundation.js';
afterEach(cleanup);
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
  expect(screen.getByRole('heading', { name: 'No accounting provider connected' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
  expect(screen.getAllByText('Not assessed · no provider mapping evidence.')).toHaveLength(4);
  expect(screen.queryByText(/0 mapped/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Reconciliation' }));
  expect(screen.getByRole('heading', { name: 'No validated reconciliation evidence' })).toBeTruthy();
});
it('exposes a disabled connection boundary with no mutation action', async () => {
  render(<FinanceDataSourcesPage />);
  expect((await screen.findByRole('button', { name: 'Connect provider' })).disabled).toBe(true);
  expect(await screen.findByRole('heading', { name: 'No accounting provider connected' })).toBeTruthy();
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
  expect(screen.getByRole('heading', { name: 'Prior accounting source' })).toBeTruthy();
  expect(screen.getByText(/Deactivation does not delete financial history/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Sync accounting data' }).every((button) => button.disabled)).toBe(true);
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
  expect(screen.getAllByText('Not assessed · no provider mapping evidence.')).toHaveLength(3);
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
