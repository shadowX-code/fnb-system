// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FinanceWorkspacePage, { FinanceOverview } from '../FinanceWorkspacePage.jsx';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { canonicalPathForRoute, getAdminRouteDefinition } from '../../../app/routeOwnership.js';
import { getSidebarSections } from '../../../../config/modules.ts';
import { reportingService } from '../../../services/reportingService.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('registers Finance IA with existing Reporting permissions and canonical paths', () => {
  const sections = getSidebarSections('finance');
  expect(sections.map((s) => s.label)).toEqual(['Finance', 'Manage']);
  const items = sections.flatMap((s) => s.items);
  expect(items.map((i) => i.label)).toEqual(['Overview', 'Analysis', 'Costs', 'Cash', 'Planning', 'Statements', 'Data Sources']);
  for (const item of items) {
    expect(canonicalPathForRoute(item.id)).toBe(`/finance/${item.id.replace('finance_', '').replaceAll('_', '-')}`);
    expect(getAdminRouteDefinition(item.id).ownership).toMatchObject({ workspace: 'finance', permission: 'reports.view' });
  }
});
it('renders demo semantics and progressive disclosure without an accounting balance invention', async () => {
  const dataset = await createFixtureProvider({ development: true }).readOverview({ scope: { kind: 'group', id: 'demo-group' }, period: monthlyPeriod('2026-09'), currency: 'MYR' });
  render(<FinanceOverview dataset={dataset} />);
  expect(screen.getByRole('status').textContent).toContain('illustrative');
  expect(screen.getByRole('heading', { name: 'Profit Architecture' })).toBeTruthy();
  expect(screen.getByText('Source, freshness & metric definitions').closest('details').open).toBe(false);
});
it('links Statements to the existing Reports owner', () => {
  window.history.replaceState(null, '', '/finance/statements');
  render(<FinanceWorkspacePage section="statements" />);
  fireEvent.click(screen.getByRole('button', { name: /Open Monthly/ }));
  expect(window.location.pathname).toBe('/restaurant/reports');
  expect(screen.getByRole('heading', { name: 'Balance Sheet' })).toBeTruthy();
});
it('shows unavailable accounting measures alongside operational reporting', async () => {
  const financials = Object.fromEntries(['revenue', 'purchaseBasedCogs', 'opex', 'netProfit'].map((key) => [key, { amount: 50, presence: 'present' }]));
  vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockResolvedValue({ financials });
  render(<FinanceWorkspacePage auth={{ hasPermission: () => true, isProtectedRole: true }} store={{ outlets: [] }} />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'A partial financial picture.' })).toBeTruthy());
  const gaps = screen.getByText(/Missing evidence ·/).closest('details');
  expect(gaps.open).toBe(false);
  expect(gaps.textContent).toContain('Gross Margin');
  expect(document.querySelector('.finance-measures').textContent).not.toContain('Unavailable');
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Financial data status' }).textContent).toContain('source timestamp unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Data Sources' }));
  expect(window.location.pathname).toBe('/finance/data-sources');
});
it('attaches shared contextual actions to Profit Flow selection and retains disclosed evidence', async () => {
  const provider = createFixtureProvider({ development: true });
  const dataset = await provider.readOverview({ scope: { kind: 'group', id: 'demo-group' }, period: monthlyPeriod('2026-09'), currency: 'MYR' });
  const before = JSON.stringify(dataset);
  render(<FinanceOverview dataset={dataset} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore COGS flow' }));
  expect(screen.getByRole('region', { name: 'Selected Profit Flow context' }).textContent).toContain('COGS');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Explain' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tabpanel', { name: 'Compare' }).textContent).toContain('Prior period unavailable');
  expect(screen.getByText('Evidence & definition for COGS').closest('details').textContent).toContain('Development illustration');
  expect(JSON.stringify(dataset)).toBe(before);
});
