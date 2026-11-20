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
  expect(await within(drawer).findByText('Baseline')).toBeTruthy();
  expect(within(drawer).queryByText('Unconfigured')).toBeNull();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Update Cost' }));
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
  expect(within(drawer).getByRole('group', { name: 'Unit cost by effective revision, RM per kg' })).toBeTruthy();
  expect(within(drawer).getByRole('button', { name: /correct cost for/i })).toBeTruthy();
});

it('exposes empty history and no cost mutation controls to view-only users', async () => {
  loadInventoryCostHistory.mockResolvedValue({ ...zeroHistory, current_revision_id: null, current_cost: null, revisions: [] });
  render(<InventoryCostHistoryDrawer item={item} canEdit={false} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByText('Unconfigured')).toBeTruthy();
  expect(screen.getByText('No cost revisions yet.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update Cost' })).toBeNull();
});
