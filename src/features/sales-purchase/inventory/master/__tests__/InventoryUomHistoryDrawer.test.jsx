import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InventoryUomHistoryDrawer from '../InventoryUomHistoryDrawer.jsx';
import { loadInventoryUomHistory, reviseInventoryUom } from '../inventoryMasterService.js';
import { getBusinessDateInput } from '../../InventorySharedPresentation.jsx';

vi.mock('../inventoryMasterService.js', () => ({ loadInventoryUomHistory: vi.fn(), reviseInventoryUom: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = { id: 'item-1', name: 'QA items', costRevisionId: 'standard-cost', cost: 1.25 };
const uoms = [{ code: 'pack', displayName: 'Pack', isActive: true }];
const baseline = { id: 'baseline', stock_unit: 'pcs' };
const current = { id: 'revision', stock_unit: 'pcs', purchase_unit: 'pack', stock_units_per_purchase_unit: 50,
  effective_date: '2026-11-20', recorded_at: '2026-11-19T21:00:00Z', actor_name: 'Alex Tan', reason: 'Supplier specification' };

it('starts collapsed and saves initial setup on the MYT business date with the setup note', async () => {
  loadInventoryUomHistory.mockResolvedValue({ stock_unit: 'pcs', current: null, revisions: [] });
  reviseInventoryUom.mockResolvedValue({ stock_unit: 'pcs', current, revisions: [current, baseline] });
  render(<InventoryUomHistoryDrawer item={item} uoms={uoms} canEdit onClose={vi.fn()} />);

  const change = await screen.findByRole('button', { name: 'Change Purchase Unit' });
  const history = screen.getByText('UOM History');
  expect(history.closest('details').open).toBe(false);
  expect(screen.queryByRole('spinbutton')).toBeNull();
  fireEvent.click(change);
  const drawer = screen.getByRole('dialog', { name: 'Manage Units' });
  expect(within(drawer).getByRole('textbox', { name: 'Stock Unit' }).readOnly).toBe(true);
  expect(screen.getByText('Advanced Details').closest('details').open).toBe(false);
  fireEvent.click(within(drawer).getByRole('button', { name: 'Purchase Unit' }));
  fireEvent.click(screen.getByRole('option', { name: 'pack · Pack' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity per Purchase Unit' }), { target: { value: '50' } });
  expect(screen.getByText('1 pack = 50 pcs')).toBeTruthy();
  expect(screen.getByText('2 packs = 100 pcs')).toBeTruthy();

  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Purchase Unit' }));
  await screen.findByRole('button', { name: 'Change Purchase Unit' });
  expect(reviseInventoryUom).toHaveBeenCalledWith(expect.objectContaining({
    itemId: item.id, stockUnit: 'pcs', purchaseUnit: 'pack', factor: 50, expectedRevisionId: null,
    reason: 'Initial purchase unit setup', effectiveDate: getBusinessDateInput(), requestId: expect.any(String),
  }));
  fireEvent.click(history);
  expect(history.closest('details').open).toBe(true);
  expect(screen.getByText('Undated baseline')).toBeTruthy();
  expect(screen.getByText('20 Nov 2026')).toBeTruthy();
  expect(screen.getByText('Alex Tan')).toBeTruthy();
});

it('requires a user-entered reason for a change and submits against the latest revision', async () => {
  const history = { stock_unit: 'pcs', current, revisions: [current, baseline] };
  loadInventoryUomHistory.mockResolvedValue(history);
  reviseInventoryUom.mockResolvedValue(history);
  render(<InventoryUomHistoryDrawer item={item} uoms={uoms} canEdit onClose={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Change Purchase Unit' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity per Purchase Unit' }), { target: { value: '60' } });
  const save = screen.getByRole('button', { name: 'Save Purchase Unit' });
  expect(save.disabled).toBe(true);
  expect(screen.getByText(/Add a reason in Advanced Details/)).toBeTruthy();
  fireEvent.click(screen.getByText('Advanced Details'));
  const reason = screen.getByRole('textbox', { name: /Reason \/ Evidence/ });
  expect(reason.required).toBe(true);
  expect(screen.getByText('Standard cost per pack · RM 75.00')).toBeTruthy();
  fireEvent.change(reason, { target: { value: 'Supplier switched pack size' } });
  fireEvent.click(save);
  await waitFor(() => expect(reviseInventoryUom).toHaveBeenCalledWith(expect.objectContaining({
    factor: 60, expectedRevisionId: current.id, reason: 'Supplier switched pack size',
  })));
});
