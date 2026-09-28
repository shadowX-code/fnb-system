import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), check: vi.fn(), tables: {} }));
vi.mock('../../../../../services/inventoryCompleteRead.js', () => ({ readCompleteInventoryRows: mocks.read }));
vi.mock('../../stockChecks/inventoryStockCheckResultService.js', () => ({ loadSubmittedStockCheck: mocks.check }));
import { loadPurchaseOrders, loadStockCheckRestock } from '../inventoryPurchaseOrdersReadService.js';

beforeEach(() => {
  mocks.tables = {
    inventory_purchase_orders: [{ id: 'p1', outlet_id: 'A', source_type: 'stock_check', source_stock_check_id: 'C', supplier_id: 'S', status: 'draft', created_by: 'auth-1' }, { id: 'p2', outlet_id: 'A', source_type: 'stock_check', source_stock_check_id: 'C', supplier_id: 'S', status: 'submitted' }, { id: 'other', outlet_id: 'B' }],
    employees: [{ id: 'employee-1', auth_user_id: 'auth-1', full_name: 'Recorded Creator' }],
    inventory_purchase_order_items: [{ id: 'L', purchase_order_id: 'p1', item_id: 'I', requested_qty: 6 }],
    inventory_item_outlets: [{ id: 'link', outlet_id: 'A', inventory_item_id: 'I', is_active: true }],
    inventory_item_outlet_suppliers: [{ id: 'sl', inventory_item_outlet_id: 'link', supplier_id: 'S' }],
    inventory_items: [{ id: 'I', item_name: 'Item', category_id: 'cat', status: 'active', unit: 'kg' }], inventory_categories: [{ id: 'cat', name: 'Category' }],
  };
  mocks.read.mockReset().mockImplementation(async (table, options = {}) => ({ data: (mocks.tables[table] || []).filter(row => Object.entries(options.eq || {}).every(([key, value]) => row[key] === value) && Object.entries(options.in || {}).every(([key, values]) => values.includes(row[key]))) }));
  mocks.check.mockReset().mockResolvedValue({ id: 'C', status: 'submitted', stockCheckType: 'scheduled', outletId: 'A', rows: [{ id: 'R', itemId: 'I', expectedQty: 10, actualCount: 4, unit: 'kg' }] });
});
it('scopes every join to verified headers and retains historical duplicate orders', async () => {
  const data = await loadPurchaseOrders(['A']);
  expect(data.orders.map(order => order.id)).toEqual(['p1', 'p2']);
  expect(data.orders[0].lines[0].requestedQty).toBe(6);
  expect(data.orders[0].createdByName).toBe('Recorded Creator');
  expect(data.orders[1].createdByName).toBe('Unknown User');
  expect(mocks.read).toHaveBeenCalledWith('inventory_purchase_order_items', expect.objectContaining({ in: { purchase_order_id: ['p1', 'p2'] } }));
  expect(mocks.read.mock.calls.map(([table]) => table)).not.toContain('inventory_stock_check_items');
});
it('rejects incomplete child evidence instead of returning a partial PO projection', async () => {
  mocks.read.mockImplementation(async table => { if (table === 'inventory_purchase_order_items') throw Object.assign(new Error('incomplete lines'), { readState: 'incomplete' }); return { data: mocks.tables[table] || [] }; });
  await expect(loadPurchaseOrders(['A'])).rejects.toMatchObject({ readState: 'incomplete' });
});
it('reuses submitted evidence and linked supplier choices for restock, retaining existing claims', async () => {
  const data = await loadStockCheckRestock('C', ['A'], [{ id: 'S', name: 'Supplier', status: 'active', outletIds: ['A'] }]);
  expect(data.suggestions[0]).toMatchObject({ stockCheckItemId: 'R', parLevel: 10, actualCount: 4, shortageQty: 6, supplierChoices: [{ id: 'S', name: 'Supplier', status: 'active', outletIds: ['A'] }] });
  expect(data.orders.map(order => order.id)).toEqual(['p1', 'p2']);
});
it('rejects inaccessible or Audit restock sources', async () => {
  await expect(loadStockCheckRestock('C', ['B'], [])).rejects.toThrow('accessible outlets');
  mocks.check.mockResolvedValue({ id: 'C', outletId: 'A', stockCheckType: 'audit' });
  await expect(loadStockCheckRestock('C', ['A'], [])).rejects.toThrow('scheduled');
});
