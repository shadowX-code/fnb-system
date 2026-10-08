// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FinanceAnalysisPage, { FinanceAnalysis } from '../FinanceAnalysisPage.jsx';
import OutletPerformanceField from '../OutletPerformanceField.jsx';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { readFinanceAnalysis } from '../analysis.js';
import { monthlyPeriod } from '../foundation.js';
import { routeDetails } from '../../../app/routes.jsx';
import { reportingService } from '../../../services/reportingService.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture(options = {}) {
  return readFinanceAnalysis(createFixtureProvider({ development: true }), { scope: { kind: 'group', id: 'demo-group' }, period: monthlyPeriod('2026-09'), currency: 'MYR' }, { ...options, allowDemo: true, outlets: [{ id: 'demo-kl', name: 'Demo KL', legalEntityId: 'demo-entity-a' }, { id: 'demo-pj', name: 'Demo PJ', legalEntityId: 'demo-entity-a' }] });
}
it('routes Analysis to its own lazy implementation', () => {
  expect(routeDetails.finance_analysis.component).not.toBe(routeDetails.finance_overview.component);
  expect(routeDetails.finance_analysis.props).toBeUndefined();
});
it('explores drivers, actions and outlets in one context without navigation', async () => {
  window.history.replaceState(null, '', '/finance/analysis');
  render(<FinanceAnalysis analysis={await fixture()} />);
  expect(screen.getByText(/Development demo · All figures/)).toBeTruthy();
  const driver = screen.getByRole('button', { name: 'Explore Revenue driver' });
  fireEvent.click(driver);
  const context = screen.getByRole('region', { name: 'Selected analysis context' });
  expect(context.textContent).toContain('Revenue');
  fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
  expect(screen.getByRole('tabpanel', { name: 'Compare' }).textContent).toContain('August 2026');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Compare' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tabpanel', { name: 'Break down' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Demo KL', exact: true })[0]);
  expect(screen.getByRole('region', { name: 'Selected scope performance' }).textContent).toContain('Demo KL');
  expect(screen.getByRole('region', { name: 'Selected analysis context' }).textContent).toContain('Revenue');
  expect(screen.getByRole('region', { name: 'Selected analysis context' }).textContent).toContain('Demo KL');
  expect(window.location.pathname).toBe('/finance/analysis');
  fireEvent.click(screen.getByRole('button', { name: 'Return to scope' }));
  expect(screen.queryByRole('region', { name: 'Selected outlet performance' })).toBeNull();
});
it('supports keyboard point selection and actual trajectory observations', async () => {
  const onSelect = vi.fn();
  const analysis = await fixture();
  render(<OutletPerformanceField outlets={analysis.outlets} selectedId="demo-kl" onSelect={onSelect} lag={1} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /^Demo KL: revenue growth/ }), { key: 'Enter' });
  expect(onSelect).toHaveBeenCalledWith('demo-kl');
  fireEvent.click(screen.getByRole('checkbox', { name: /Show 3-month/ }));
  expect(screen.getByText('Selected outlet trajectory evidence')).toBeTruthy();
  expect(screen.getAllByText(/July 2026 · growth/)[0]).toBeTruthy();
});
it('does not connect history across a missing observation', async () => {
  const analysis = await fixture();
  analysis.outlets[0].history[1].x = null;
  render(<OutletPerformanceField outlets={[analysis.outlets[0]]} selectedId="demo-kl" onSelect={() => {}} lag={1} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /Show 3-month/ }));
  expect(document.querySelectorAll('.finance-field-trajectory')).toHaveLength(0);
});
it('keeps unpositioned outlets explicit and handles source failure separately from zero', async () => {
  const analysis = await fixture();
  analysis.outlets[0].position.x = null;
  analysis.outlets[0].position.reason = 'Missing comparison Revenue.';
  analysis.outlets[1].pair = null;
  analysis.outlets[1].position = undefined;
  analysis.outlets[1].error = 'Financial evidence could not be loaded for this outlet.';
  render(<OutletPerformanceField outlets={analysis.outlets} onSelect={() => {}} lag={1} />);
  expect(screen.getByText('No outlets can be positioned yet')).toBeTruthy();
  fireEvent.click(screen.getByText('Outlet detail · 0 positioned / 2 eligible'));
  expect(screen.getByText('Missing comparison Revenue.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Demo PJ', exact: true }).disabled).toBe(true);
});
it('only requests authorized outlet evidence and recovers from a read failure', async () => {
  const spy = vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockRejectedValueOnce(new Error('Read unavailable')).mockResolvedValue({ financials: Object.fromEntries(['revenue', 'purchaseBasedCogs', 'opex', 'netProfit'].map((field) => [field, { amount: null, presence: 'missing' }])) });
  render(<FinanceAnalysisPage auth={{ roleOutletIds: ['allowed'] }} store={{ outlets: [{ id: 'allowed', name: 'Allowed outlet' }, { id: 'hidden', name: 'Hidden outlet' }] }} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Profit Drivers' })).toBeTruthy());
  expect(screen.getByText('No outlets can be positioned yet')).toBeTruthy();
  expect(spy.mock.calls.some(([query]) => query.outletId === 'hidden')).toBe(false);
  expect(screen.queryByText('Hidden outlet')).toBeNull();
});

it('preserves selected context when equivalent auth/store wrappers rerender', async () => {
  const spy = vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockResolvedValue({ financials: Object.fromEntries(['revenue', 'purchaseBasedCogs', 'opex', 'netProfit'].map((field) => [field, { amount: null, presence: 'missing' }])) });
  const props = () => ({ auth: { roleOutletIds: ['allowed'] }, store: { outlets: [{ id: 'allowed', name: 'Allowed outlet' }] } });
  const view = render(<FinanceAnalysisPage {...props()} />);
  await screen.findByRole('heading', { name: 'Profit Drivers' });
  fireEvent.click(screen.getByText('Outlet detail · 0 positioned / 1 eligible'));
  fireEvent.click(screen.getByRole('button', { name: 'Allowed outlet', exact: true }));
  expect(screen.getByRole('region', { name: 'Selected outlet performance' })).toBeTruthy();
  const reads = spy.mock.calls.length;
  view.rerender(<FinanceAnalysisPage {...props()} />);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Selected outlet performance' })).toBeTruthy());
  expect(spy).toHaveBeenCalledTimes(reads);
});

it('retains all three selections independently while summaries keep toolbar scope', async () => {
  const analysis = await fixture({includeHistory:true}), before = JSON.stringify(analysis);
  render(<FinanceAnalysis analysis={analysis}/>);
  const summary = screen.getByRole('region',{name:'Financial performance'});
  const summaryBefore = summary.textContent;
  expect(summary.querySelectorAll('[data-admin-summary-card]')).toHaveLength(5);
  expect(summary.querySelectorAll('svg.lucide')).toHaveLength(5);
  expect(within(summary).getByText('EBITDA Margin')).toBeTruthy();
  expect(screen.queryByRole('heading',{name:'Business performance'})).toBeNull();
  expect(screen.queryByRole('tab',{name:'Outlets'})).toBeNull();
  const driver = screen.getByRole('group',{name:'Driver Contribution'});
  const field = screen.getByRole('group',{name:'Outlet revenue growth and EBITDA margin field'});
  const trend = screen.getByRole('group',{name:'Monthly EBITDA Margin history'});
  const drivers = within(driver.closest('[data-admin-analytical-surface]'));
  const outlets = within(field.closest('[data-admin-analytical-surface]'));
  const profitability = within(trend.closest('[data-admin-analytical-surface]'));
  fireEvent.click(screen.getByRole('button',{name:'Explore Revenue driver'}));
  fireEvent.click(drivers.getByRole('tab',{name:'Compare'}));
  fireEvent.keyDown(within(field).getByRole('button',{name:/^Demo KL: revenue growth/}),{key:'Enter'});
  fireEvent.click(outlets.getByRole('tab',{name:'Break down'}));
  fireEvent.click(within(trend).getByRole('button',{name:'July 2026 EBITDA Margin'}));
  fireEvent.click(profitability.getByRole('tab',{name:'Compare'}));
  expect(drivers.getByRole('tabpanel',{name:'Compare'}).textContent).toContain('September 2026');
  expect(drivers.getByRole('heading',{name:'Revenue'})).toBeTruthy();
  expect(outlets.getByRole('region',{name:'Selected analysis context'}).textContent).toContain('Demo KL');
  expect(outlets.getByRole('tabpanel',{name:'Break down'})).toBeTruthy();
  expect(profitability.getByRole('tabpanel',{name:'Compare'}).textContent).toContain('July 2026');
  expect(profitability.getByRole('tabpanel',{name:'Compare'}).textContent).not.toContain('September 2026');
  fireEvent.click(screen.getByRole('checkbox',{name:/Show 3-month/}));
  fireEvent.click(screen.getByRole('tab',{name:'12M'}));
  expect(screen.getByRole('group',{name:'Driver Contribution'})).toBe(driver);
  expect(summary.textContent).toBe(summaryBefore);
  expect(screen.getAllByRole('region',{name:'Selected analysis context'})).toHaveLength(3);
  expect(JSON.stringify(analysis)).toBe(before);
});
