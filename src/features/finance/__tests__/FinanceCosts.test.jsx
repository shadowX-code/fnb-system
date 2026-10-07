// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FinanceCostsPage, { FinanceCosts } from '../FinanceCostsPage.jsx';
import { readFinanceAnalysis } from '../analysis.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { routeDetails } from '../../../app/routes.jsx';
import { reportingService } from '../../../services/reportingService.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() { return readFinanceAnalysis(createFixtureProvider({ development: true }), { scope: { kind: 'group', id: 'demo-group' }, period: monthlyPeriod('2026-09'), currency: 'MYR' }, { allowDemo: true }); }
it('owns Costs separately and provides a coherent parent / classification drill with shared actions', async () => {
  expect(routeDetails.finance_costs.component).not.toBe(routeDetails.finance_overview.component);
  window.history.replaceState(null, '', '/finance/costs');
  render(<FinanceCosts analysis={await fixture()} />);
  expect(screen.getByRole('heading', { name: 'Margin Pressure Map' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Break down' }));
  fireEvent.click(screen.getByRole('button', { name: 'Investigate Food', exact: true }));
  expect(screen.getByRole('navigation', { name: 'Cost drill path' }).textContent).toContain('COGS/Food');
  expect(screen.getByRole('heading', { name: 'Food', exact: true })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Break down' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('table', { name: 'Food · period comparison' }).textContent).toContain('Revenue share');
  fireEvent.click(screen.getByRole('navigation', { name: 'Cost drill path' }).querySelector('button:nth-of-type(2)'));
  expect(screen.getByRole('heading', { name: 'COGS', exact: true })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Compare' }).getAttribute('aria-selected')).toBe('true');
  expect(window.location.pathname).toBe('/finance/costs');
});
it('keeps unavailable labour and classifications explicit for live operational evidence', async () => {
  const pair = await fixture();
  for (const dataset of [pair.current, pair.previous]) {
    dataset.metrics.labour = { ...dataset.metrics.labour, value: null, completeness: 'unavailable', provenance: [] };
    delete dataset.classifications;
  }
  pair.profitDriverModel = { label: 'Operational basis', drivers: ['revenue', 'cogs', 'opex'] };
  render(<FinanceCosts analysis={pair} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore Labour Cost layer' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Break down' }));
  expect(screen.getByRole('tabpanel').textContent).toContain('No validated classified evidence');
  expect(screen.getByRole('button', { name: 'Explore Labour Cost layer' }).textContent).toContain('—');
});
it('requests only the chosen canonical scope and comparison, preserves context and recovers read failure', async () => {
  const spy = vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockRejectedValueOnce(new Error('failed')).mockResolvedValue({ financials: Object.fromEntries(['revenue', 'purchaseBasedCogs', 'opex', 'netProfit'].map((field) => [field, { amount: null, presence: 'missing' }])) });
  const props = () => ({ auth: { roleOutletIds: ['allowed'] }, store: { outlets: [{ id: 'allowed', name: 'Allowed outlet' }, { id: 'hidden', name: 'Hidden outlet' }] } });
  const view = render(<FinanceCostsPage {...props()} />);
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await screen.findByRole('heading', { name: 'Margin Pressure Map' });
  expect(screen.getByText('Margin pressure evidence not ready')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Explore OPEX layer' }).textContent).toContain('—');
  fireEvent.click(screen.getByRole('tab', { name: 'Break down' }));
  fireEvent.click(screen.getByText('Movement method & evidence'));
  fireEvent.click(screen.getByRole('button', { name: 'Investigate OPEX' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
  const count = spy.mock.calls.length; view.rerender(<FinanceCostsPage {...props()} />);
  await waitFor(() => expect(screen.getByRole('table', { name: 'OPEX · period comparison' })).toBeTruthy());
  expect(spy.mock.calls.length).toBe(count);
  expect(spy.mock.calls.every(([query]) => query.outletId === null)).toBe(true);
  expect(screen.queryByText('Hidden outlet')).toBeNull();
});
