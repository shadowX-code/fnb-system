import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InventoryItemUomSection from '../InventoryItemUomSection.jsx';
import { changeInventoryStockUom, loadInventoryStockUomHistory } from '../inventoryMasterService.js';

vi.mock('../inventoryMasterService.js', () => ({ changeInventoryStockUom: vi.fn(), loadInventoryStockUomHistory: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = { id: 'item-1', name: 'QA item', unit: 'pcs' };
const uoms = [
  { code: 'pcs', displayName: 'Pieces', isActive: true },
  { code: 'pack', displayName: 'Pack', isActive: true },
];
const history = { unit: 'pcs', blocked_reason: null, requires_conversion: true, current_cost: 10, current_cost_revision_id: 'cost-old', changes: [] };

it('saves a used item with one conversion value and shows the server history', async () => {
  const onChanged = vi.fn();
  loadInventoryStockUomHistory.mockResolvedValue(history);
  changeInventoryStockUom.mockResolvedValue({ unit: 'pack', blocked_reason: null, changes: [{
    id: 'revision', old_unit: 'pcs', new_unit: 'pack', reason: 'Changed item UOM using the specified conversion', old_quantity: 24, new_quantity: 1,
    actor_name: 'Alex Tan', recorded_at: '2026-11-21T01:00:00Z',
  }] });
  render(<InventoryItemUomSection item={item} uoms={uoms} onChanged={onChanged} onSavingChange={vi.fn()} />);

  expect(screen.getByText('Current UOM')).toBeTruthy();
  expect(screen.queryByText('Purchase Unit')).toBeNull();
  const disclosure = await screen.findByText('UOM History');
  expect(disclosure.closest('details').open).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Change UOM' }));
  fireEvent.click(screen.getByRole('button', { name: /^New UOM/ }));
  expect(screen.queryByRole('option', { name: /Pieces/ })).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: 'pack · Pack' }));

  const conversion = screen.getByRole('spinbutton', { name: /^1 pack = how many pcs/ });
  const save = screen.getByRole('button', { name: 'Save UOM Change' });
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  expect(screen.queryByRole('textbox', { name: /^Reason/ })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(save.disabled).toBe(true);
  fireEvent.change(conversion, { target: { value: '0.000001' } });
  expect(screen.getByText(/Equivalent cost exceeds supported precision/)).toBeTruthy();
  expect(save.disabled).toBe(true);
  fireEvent.change(conversion, { target: { value: '24' } });
  expect(screen.getByText('1 pack = 24 pcs')).toBeTruthy();
  expect(screen.getByText(/RM 10.00 \/ pcs.*RM 240.00 \/ pack/)).toBeTruthy();
  fireEvent.click(save);
  await screen.findByRole('button', { name: 'Change UOM' });
  expect(changeInventoryStockUom).toHaveBeenCalledWith(expect.objectContaining({
    itemId: item.id, expectedUnit: 'pcs', expectedChangeId: null, unit: 'pack',
    conversion: '24',
    expectedCostRevisionId: 'cost-old', requestId: expect.any(String),
  }));
  expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ unit: 'pack' }));
  fireEvent.click(disclosure);
  expect(screen.getByText('Alex Tan')).toBeTruthy();
  expect(screen.getByText('Changed item UOM using the specified conversion')).toBeTruthy();
  expect(screen.getByText('1 pack = 24 pcs')).toBeTruthy();
});

it('saves an unused item without a conversion', async () => {
  loadInventoryStockUomHistory.mockResolvedValue({ ...history, requires_conversion: false, current_cost: null, current_cost_revision_id: null });
  changeInventoryStockUom.mockResolvedValue({ unit: 'pack', requires_conversion: false, changes: [] });
  render(<InventoryItemUomSection item={item} uoms={uoms} onChanged={vi.fn()} onSavingChange={vi.fn()} />);
  await screen.findByText('UOM History');
  fireEvent.click(screen.getByRole('button', { name: 'Change UOM' }));
  fireEvent.click(screen.getByRole('button', { name: /^New UOM/ }));
  fireEvent.click(screen.getByRole('option', { name: 'pack · Pack' }));
  expect(screen.queryByRole('spinbutton')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save UOM Change' }));
  await screen.findByRole('button', { name: 'Change UOM' });
  expect(changeInventoryStockUom).toHaveBeenCalledWith(expect.objectContaining({ conversion: null, unit: 'pack' }));
});

it('explains the server blocker and leaves genuine history available', async () => {
  loadInventoryStockUomHistory.mockResolvedValue({ ...history, blocked_reason: 'This item has saved Par levels.' });
  render(<InventoryItemUomSection item={item} uoms={uoms} onChanged={vi.fn()} onSavingChange={vi.fn()} />);
  expect(await screen.findByText('This item has saved Par levels.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Change UOM' }).disabled).toBe(true);
  expect(screen.getByText('UOM History')).toBeTruthy();
  expect(changeInventoryStockUom).not.toHaveBeenCalled();
});
