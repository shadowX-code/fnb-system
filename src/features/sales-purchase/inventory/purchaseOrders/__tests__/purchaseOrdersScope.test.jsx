// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const load = vi.hoisted(() => vi.fn());
vi.mock('../inventoryPurchaseOrdersReadService.js', () => ({ loadPurchaseOrders: load, loadStockCheckRestock: load }));
import useInventoryPurchaseOrdersRead from '../useInventoryPurchaseOrdersRead.js';
afterEach(() => { cleanup(); load.mockReset(); });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
it('hides previous-scope rows immediately, ignores late responses, and retains verified same-scope refresh data', async () => {
  const pendingA = deferred(), pendingB = deferred(), refreshB = deferred();
  load.mockResolvedValueOnce({ orders: ['A'] }).mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(refreshB.promise);
  const { result, rerender } = renderHook(props => useInventoryPurchaseOrdersRead(props), { initialProps: { outletIds: ['A'], scopeKey: 'user', enabled: true } });
  await waitFor(() => expect(result.current.data?.orders).toEqual(['A']));
  act(() => { result.current.refresh(); });
  expect(result.current.data.orders).toEqual(['A']);
  rerender({ outletIds: ['B'], scopeKey: 'user', enabled: true });
  expect(result.current.data).toBeNull();
  await act(async () => { pendingA.resolve({ orders: ['late A'] }); });
  expect(result.current.data).toBeNull();
  await act(async () => { pendingB.resolve({ orders: ['B'] }); });
  expect(result.current.data.orders).toEqual(['B']);
  act(() => { result.current.refresh(); });
  expect(result.current.data.orders).toEqual(['B']);
  await act(async () => { refreshB.reject(Object.assign(new Error('capped'), { readState: 'incomplete' })); });
  expect(result.current).toMatchObject({ data: null, state: 'incomplete', error: 'capped' });
});
it('clears projection on access removal and guards a late identity response', async () => {
  const a = deferred(), b = deferred(); load.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const { result, rerender } = renderHook(props => useInventoryPurchaseOrdersRead(props), { initialProps: { outletIds: ['A'], scopeKey: 'user', enabled: true, checkId: 'C1' } });
  rerender({ outletIds: ['A'], scopeKey: 'user', enabled: true, checkId: 'C2' });
  await act(async () => { a.resolve({ check: 'C1' }); }); expect(result.current.data).toBeNull();
  rerender({ outletIds: ['A'], scopeKey: 'user', enabled: false, checkId: 'C2' });
  await act(async () => { b.resolve({ check: 'C2' }); }); expect(result.current.data).toBeNull();
});
