// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FinanceCashPage, { FinanceCash } from '../FinanceCashPage.jsx';
import { readFinanceAnalysis } from '../analysis.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { routeDetails } from '../../../app/routes.jsx';
import { reportingService } from '../../../services/reportingService.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const request = { scope: { kind: 'outlet', id: 'demo-kl' }, period: monthlyPeriod('2026-09'), currency: 'MYR' };
async function fixture() { return readFinanceAnalysis(createFixtureProvider({ development: true }), request, { allowDemo: true }); }
it('owns Cash and preserves shared contextual actions through cycle and expected-event selection', async () => {
  expect(routeDetails.finance_cash.component).not.toBe(routeDetails.finance_overview.component);
  render(<FinanceCash analysis={await fixture()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore Accounts Receivable stage' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Break down' }));
  expect(screen.getByRole('tabpanel').textContent).toContain('Aggregate receivables');
  fireEvent.click(screen.getByRole('tabpanel').querySelector('button'));
  expect(screen.getByRole('heading', { name: 'AR Days', exact: true })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Break down' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tabpanel').textContent).toContain('days');
  fireEvent.click(screen.getByRole('button', { name: 'Investigate Illustrative payroll commitment' }));
  expect(screen.getByRole('heading', { name: 'Illustrative payroll commitment' })).toBeTruthy();
  expect(screen.getByRole('tabpanel').textContent).toContain('No matched historical comparison');
  fireEvent.click(screen.getByRole('tab', { name: 'Explain' }));
  expect(screen.getByRole('tabpanel').textContent).toContain('2026-10-12');
  expect(screen.getByRole('tabpanel').textContent).toContain('Forecast');
});
it('renders known partial events without manufacturing expected positions or lowest point', async () => {
  const data = await fixture(); data.current.liquiditySchedule.completeness = 'partial';
  render(<FinanceCash analysis={data} />);
  expect(screen.getByRole('list', { name: 'Dated liquidity checkpoints' }).textContent).toContain('Incomplete coverage');
  expect(screen.getByText('Expected positions unavailable')).toBeTruthy();
  expect(screen.getByText('Expected lowest point').parentElement.textContent).toContain('Unavailable');
});
it('recovers canonical read failure and keeps live missing balances distinct from supplied profit', async () => {
  const spy = vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockRejectedValueOnce(new Error('failed')).mockResolvedValue({ financials: { revenue: { amount: 100, presence: 'present' }, purchaseBasedCogs: { amount: 30, presence: 'present' }, opex: { amount: 20, presence: 'present' }, netProfit: { amount: 50, presence: 'present' } } });
  render(<FinanceCashPage auth={{ roleOutletIds: ['allowed'] }} store={{ outlets: [{ id: 'allowed', name: 'Allowed' }, { id: 'hidden', name: 'Hidden' }] }} />);
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await screen.findByRole('heading', { name: 'Liquidity timeline' });
  expect(screen.getByRole('list', { name: 'Liquidity evidence required' }).textContent).toContain('Unavailable');
  expect(screen.getByRole('list', { name: 'Liquidity evidence required' }).textContent).toContain('no complete projection');
  expect(screen.queryByText('Hidden')).toBeNull();
  expect(spy.mock.calls.every(([query]) => query.outletId === null)).toBe(true);
  expect(screen.getByRole('table').textContent).toContain('Operational');
});
