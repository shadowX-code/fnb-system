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
const history = { unit: 'pcs', blocked_reason: null, changes: [] };

it('records an actual UOM change with a reason and shows the server history', async () => {
  const onChanged = vi.fn();
  loadInventoryStockUomHistory.mockResolvedValue(history);
  changeInventoryStockUom.mockResolvedValue({ unit: 'pack', blocked_reason: null, changes: [{
    id: 'revision', old_unit: 'pcs', new_unit: 'pack', reason: 'Corrected the catalogue unit',
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

  const save = screen.getByRole('button', { name: 'Save UOM Change' });
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: /^Reason/ }), { target: { value: 'Corrected the catalogue unit' } });
  fireEvent.click(save);
  await screen.findByRole('button', { name: 'Change UOM' });
  expect(changeInventoryStockUom).toHaveBeenCalledWith(expect.objectContaining({
    itemId: item.id, expectedUnit: 'pcs', expectedChangeId: null, unit: 'pack',
    reason: 'Corrected the catalogue unit', requestId: expect.any(String),
  }));
  expect(onChanged).toHaveBeenCalledWith('pack');
  fireEvent.click(disclosure);
  expect(screen.getByText('Alex Tan')).toBeTruthy();
  expect(screen.getByText('Corrected the catalogue unit')).toBeTruthy();
});

it('explains the server blocker and leaves genuine history available', async () => {
  loadInventoryStockUomHistory.mockResolvedValue({ ...history, blocked_reason: 'This item has saved Par levels.' });
  render(<InventoryItemUomSection item={item} uoms={uoms} onChanged={vi.fn()} onSavingChange={vi.fn()} />);
  expect(await screen.findByText('This item has saved Par levels.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Change UOM' }).disabled).toBe(true);
  expect(screen.getByText('UOM History')).toBeTruthy();
  expect(changeInventoryStockUom).not.toHaveBeenCalled();
});
