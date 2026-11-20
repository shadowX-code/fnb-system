// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getBusinessDateInput } from '../../InventorySharedPresentation.jsx';
import InventoryCostHistoryDrawer from '../InventoryCostHistoryDrawer.jsx';
import { loadInventoryCostHistory, reviseInventoryCost } from '../inventoryMasterService.js';

vi.mock('../inventoryMasterService.js', () => ({
  loadInventoryCostHistory: vi.fn(),
  reviseInventoryCost: vi.fn(),
}));

afterEach(cleanup);
const item = { id: 'item-id', name: 'Rice' };
const baseline = { id: 'baseline', effective_date: null, unit_cost: 0, unit: 'kg', reason: 'Existing configured cost', recorded_at: '2024-03-15T08:00:00Z' };
const zeroHistory = { current_revision_id: baseline.id, current_cost: 0, previous_cost: null, unit: 'kg', revisions: [baseline] };

it('opens and previews a revision from a configured zero, then uses server read-back', async () => {
  loadInventoryCostHistory.mockResolvedValue(zeroHistory);
  const today = getBusinessDateInput('Asia/Kuala_Lumpur');
  reviseInventoryCost.mockResolvedValue({
    ...zeroHistory, current_revision_id: 'current', current_cost: 1.2345, previous_cost: 0,
    revisions: [{ ...baseline, id: 'current', effective_date: today, unit_cost: 1.2345, reason: 'Updated quote', actor_name: 'Inventory editor' }, baseline],
  });
  const onSaved = vi.fn();
  render(<InventoryCostHistoryDrawer item={item} canEdit onClose={vi.fn()} onSaved={onSaved} />);
  const drawer = screen.getByRole('dialog', { name: 'Cost History' });
  const baselineMark = await within(drawer).findByRole('button', { name: 'Baseline cost · RM 0.00 / kg' });
  fireEvent.focus(baselineMark);
  expect(within(screen.getByRole('tooltip')).getByText('No effective date recorded')).toBeTruthy();
  expect(baselineMark.closest('svg').querySelector('.admin-chart-series')).toBeNull();
  fireEvent.blur(baselineMark);
  expect(within(drawer).queryByText('Unconfigured')).toBeNull();
  const update = within(drawer).getByRole('button', { name: 'Update Cost' });
  expect(update.getAttribute('aria-expanded')).toBe('false');
  expect(within(drawer).queryByLabelText(/new cost/i)).toBeNull();
  fireEvent.click(update);
  expect(update.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(update);
  fireEvent.click(update);
  fireEvent.change(within(drawer).getByLabelText(/new cost/i), { target: { value: '1.23456' } });
  fireEvent.change(within(drawer).getByLabelText('Reason'), { target: { value: 'Updated quote' } });
  expect(within(drawer).getByRole('button', { name: 'Save Cost Revision' }).disabled).toBe(true);
  fireEvent.change(within(drawer).getByLabelText(/new cost/i), { target: { value: '1.2345' } });
  expect(within(drawer).getByText(/percentage unavailable from RM 0/)).toBeTruthy();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Cost Revision' }));
  expect(await within(drawer).findByText('Updated quote')).toBeTruthy();
  expect(reviseInventoryCost).toHaveBeenCalledWith(expect.objectContaining({
    itemId: item.id, cost: 1.2345, unit: 'kg', reason: 'Updated quote', effectiveDate: today,
    expectedRevisionId: 'baseline', correctedRevisionId: null, requestId: expect.any(String),
  }));
  expect(onSaved).toHaveBeenCalledOnce();
  expect(update.getAttribute('aria-expanded')).toBe('false');
  expect(within(drawer).queryByLabelText(/new cost/i)).toBeNull();
  const sparseChart = within(drawer).getByRole('group', { name: 'Cost trend, RM per kg' });
  expect(within(sparseChart).getAllByRole('button')).toHaveLength(2);
  expect(sparseChart.querySelector('.admin-chart-series')).toBeNull();
  expect(within(drawer).getByRole('button', { name: /correct cost for/i })).toBeTruthy();
});

it('exposes empty history and no cost mutation controls to view-only users', async () => {
  loadInventoryCostHistory.mockResolvedValue({ ...zeroHistory, current_revision_id: null, current_cost: null, revisions: [] });
  render(<InventoryCostHistoryDrawer item={item} canEdit={false} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByText('Unconfigured')).toBeTruthy();
  expect(screen.getByText('No cost revisions yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update Cost' })).toBeNull();
});

it('keeps the baseline off the time axis and compares revisions in corrected effective order', async () => {
  const first = { ...baseline, id: 'first', effective_date: '2025-01-01', unit_cost: 2, reason: 'First quote' };
  const later = { ...first, id: 'later', effective_date: '2025-02-01', unit_cost: 4, reason: 'Later quote' };
  const correction = { ...first, id: 'correction', unit_cost: 3.1254, reason: 'Corrected quote', supersedes_revision_id: first.id };
  const current = { ...later, id: 'current', effective_date: '2025-06-01', unit_cost: 3, reason: 'Current quote', previous_revision_id: correction.id };
  loadInventoryCostHistory.mockResolvedValue({
    ...zeroHistory, current_revision_id: current.id, current_cost: 3, previous_cost: 4,
    revisions: [current, correction, later, first, baseline],
  });
  render(<InventoryCostHistoryDrawer item={item} canEdit onClose={vi.fn()} onSaved={vi.fn()} />);
  const chart = await screen.findByRole('group', { name: 'Cost trend, RM per kg' });
  const marks = within(chart).getAllByRole('button');
  expect(marks).toHaveLength(4);
  expect(marks.map(mark => mark.getAttribute('aria-label'))).toEqual([
    'Baseline cost · RM 0.00 / kg',
    'Effective 1 Jan 2025 · RM 3.1254 / kg',
    'Effective 1 Feb 2025 · RM 4.00 / kg',
    'Effective 1 Jun 2025 · RM 3.00 / kg',
  ]);
  const baselinePoint = marks[0].querySelector('.chart-point');
  expect(baselinePoint.getAttribute('fill')).toBe('var(--surface)');
  expect(baselinePoint.getAttribute('stroke')).toBe('var(--chart-slate)');
  const corrected = within(chart).getByRole('button', { name: /Effective.*RM 3.1254/ });
  const series = chart.querySelector('.admin-chart-series');
  expect(series.getAttribute('stroke-width')).toBe('2');
  expect(series.getAttribute('stroke')).toBe('var(--chart-emerald)');
  const path = series.getAttribute('d');
  expect(path.match(/[A-Z]/g)).toEqual(['M', 'C', 'C']);
  expect(Number(path.match(/^M([\d.]+),/)[1])).toBeCloseTo(Number(corrected.querySelector('.chart-point').getAttribute('cx')), 2);

  fireEvent.pointerEnter(corrected, { pointerType: 'mouse' });
  const tooltip = within(screen.getByRole('tooltip'));
  expect(tooltip.getByText('RM 3.1254 / kg')).toBeTruthy();
  expect(tooltip.getByText('Corrected revision')).toBeTruthy();
  expect(chart.querySelector('.admin-chart-crosshair').getAttribute('x1'))
    .toBe(corrected.querySelector('.chart-point').getAttribute('cx'));
  expect(fireEvent.keyDown(corrected, { key: 'Escape' })).toBe(false);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(chart.querySelector('.admin-chart-crosshair')).toBeNull();

  const table = screen.getByRole('table');
  expect(within(table).getByRole('columnheader', { name: 'Change (RM)' })).toBeTruthy();
  expect(within(table).getByRole('columnheader', { name: 'Change (%)' })).toBeTruthy();
  const currentRow = within(table).getByRole('row', { name: /Current quote/ });
  expect(within(currentRow).getByText('-25%').classList.contains('badge-success')).toBe(true);
  expect(within(currentRow).getByText('−RM 1.00').closest('.badge')).toBeNull();
  const laterRow = within(table).getByRole('row', { name: /Later quote/ });
  expect(within(laterRow).getByText('+RM 0.8746')).toBeTruthy();
  expect(within(laterRow).getByText('+27.98%').classList.contains('badge-danger')).toBe(true);
  const correctedRow = within(table).getByRole('row', { name: /Corrected quote/ });
  expect(within(correctedRow).getByText('+RM 3.1254')).toBeTruthy();
  expect(within(correctedRow).getByText('Percentage unavailable from RM 0')).toBeTruthy();
  expect(within(table).getByRole('row', { name: /Superseded/ })).toBeTruthy();
});

it('distinguishes the current correction from the change on its effective date', async () => {
  const original = { ...baseline, id: 'original', effective_date: '2025-01-01', unit_cost: 7, reason: 'Original quote' };
  const corrected = { ...original, id: 'corrected', unit_cost: 5, supersedes_revision_id: original.id, reason: 'Corrected quote' };
  loadInventoryCostHistory.mockResolvedValue({
    ...zeroHistory, current_revision_id: corrected.id, current_cost: 5, previous_cost: 7,
    revisions: [corrected, original, { ...baseline, unit_cost: 5 }],
  });
  render(<InventoryCostHistoryDrawer item={item} canEdit onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByText('Previous cost before correction')).toBeTruthy();
  expect(screen.getByText('-28.57%').classList.contains('badge-success')).toBe(true);
  const correctedRow = within(screen.getByRole('row', { name: /Corrected quote/ }));
  expect(correctedRow.getByText('0%').classList.contains('badge-neutral')).toBe(true);
});
