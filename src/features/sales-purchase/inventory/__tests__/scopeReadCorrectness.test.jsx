import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ waste: vi.fn(), movements: vi.fn() }));
vi.mock('../waste/inventoryWasteService.js', () => ({ loadInventoryWaste: reads.waste }));
vi.mock('../movements/inventoryMovementService.js', () => ({ loadInventoryMovements: reads.movements }));
import useWaste from '../waste/useInventoryWasteRead.js';
import useMovements from '../movements/useInventoryMovementsRead.js';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
describe.each([
  ['Wastage', useWaste, reads.waste, scope => ({ outletId: scope, scopeKey: scope, enabled: true })],
  ['Movements', useMovements, reads.movements, scope => ({ outletIds: [scope], scopeKey: scope, enabled: true })],
])('%s verified scope reads', (_name, useRead, load, props) => {
  it('hides the loaded old scope while new scope is pending and retains data only on same-scope refresh', async () => {
    const next = deferred(); const refresh = deferred();
    load.mockResolvedValueOnce({ rows: ['A'] }).mockReturnValueOnce(next.promise).mockReturnValueOnce(refresh.promise);
    const view = renderHook(({ scope }) => useRead(props(scope)), { initialProps: { scope: 'A' } });
    await act(async () => {});
    expect(view.result.current.data.rows).toEqual(['A']);
    view.rerender({ scope: 'B' });
    expect(view.result.current.state).toBe('loading');
    expect(view.result.current.data).toBeNull();
    await act(async () => next.resolve({ rows: ['B'] }));
    expect(view.result.current.data.rows).toEqual(['B']);
    let pending;
    act(() => { pending = view.result.current.refresh(); });
    expect(view.result.current.state).toBe('refreshing');
    expect(view.result.current.data.rows).toEqual(['B']);
    await act(async () => { refresh.resolve({ rows: ['B refreshed'] }); await pending; });
    expect(view.result.current.data.rows).toEqual(['B refreshed']);
  });
  it('ignores an old response after the current scope has completed', async () => {
    const old = deferred();
    load.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ rows: ['B'] });
    const view = renderHook(({ scope }) => useRead(props(scope)), { initialProps: { scope: 'A' } });
    view.rerender({ scope: 'B' });
    await act(async () => {});
    await act(async () => old.resolve({ rows: ['A stale'] }));
    expect(view.result.current.data.rows).toEqual(['B']);
  });
});
