import { expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../../../../services/inventoryLifecycleService.js', () => ({ inventoryLifecycleService: { createStockCheckPurchaseOrders: create } }));
import { persistRemoteDraftPurchaseOrders } from '../inventoryPurchaseOrderService.js';
it('groups supplier intents atomically and preserves exact request/payload identity on retry', async () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const check = { id: id(1), outletId: id(2), status: 'submitted', stockCheckType: 'scheduled' };
  const rows = [3,4,3].map((supplier, i) => ({ itemId: id(10+i), stockCheckItemId: id(20+i), selectedSupplierId: id(supplier), suggestedOrderQty: i+1, unit: 'kg' }));
  const request = { requestId: id(30), poTimestamp: 123456789 };
  await persistRemoteDraftPurchaseOrders(check, rows, request);
  await persistRemoteDraftPurchaseOrders(check, rows, request);
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  expect(create.mock.calls[0][0]).toMatchObject({ stockCheckId: check.id, requestId: request.requestId, orders: [expect.objectContaining({ supplier_id: id(3), lines: expect.any(Array) }), expect.objectContaining({ supplier_id: id(4), lines: expect.any(Array) })] });
  expect(create.mock.calls[0][0].orders[0].lines).toHaveLength(2);
});
