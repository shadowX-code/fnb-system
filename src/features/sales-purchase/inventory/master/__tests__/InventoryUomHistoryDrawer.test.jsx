import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import InventoryUomHistoryDrawer from '../InventoryUomHistoryDrawer.jsx';
import { loadInventoryUomHistory, reviseInventoryUom } from '../inventoryMasterService.js';

vi.mock('../inventoryMasterService.js', () => ({ loadInventoryUomHistory: vi.fn(), reviseInventoryUom: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = { id: 'item-1', name: 'QA cartons', costRevisionId: 'standard-cost', cost: 1.25 };
const uoms = [{ code: 'carton', displayName: 'Carton', isActive: true }];

it('previews the quantity and equivalent standard cost and saves a purchase unit revision', async () => {
  loadInventoryUomHistory.mockResolvedValue({ stock_unit: 'pcs', current: null, revisions: [] });
  reviseInventoryUom.mockImplementation(async request => {
    const current = { id: 'revision', stock_unit: 'pcs', purchase_unit: request.purchaseUnit,
      stock_units_per_purchase_unit: request.factor, effective_date: request.effectiveDate, reason: request.reason };
    return { stock_unit: 'pcs', current, revisions: [current, { id: 'baseline', stock_unit: 'pcs' }] };
  });
  render(<InventoryUomHistoryDrawer item={item} uoms={uoms} canEdit onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Change Purchase UOM' }));
  const drawer = screen.getByRole('dialog', { name: 'Manage Units' });
  fireEvent.click(within(drawer).getByRole('button', { name: /^Purchase UOM/ }));
  fireEvent.click(screen.getByRole('option', { name: 'carton · Carton' }));
  fireEvent.change(screen.getByLabelText(/stock units/i), { target: { value: '12' } });
  expect(screen.getByText('1 carton = 12 pcs')).toBeTruthy();
  expect(screen.getByText(/RM 15\.00/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Reason / Evidence'), { target: { value: 'Supplier specification' } });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Save Purchase UOM' }));
  expect(await screen.findByText('Undated baseline')).toBeTruthy();
  expect(reviseInventoryUom).toHaveBeenCalledWith(expect.objectContaining({
    itemId: item.id, stockUnit: 'pcs', purchaseUnit: 'carton', factor: 12,
    expectedRevisionId: null, reason: 'Supplier specification', requestId: expect.any(String),
  }));
});
