import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/inventoryCompleteRead.js', () => ({ readCompleteInventoryRows: read }));
import InventoryStockCheckResultSurface from '../../inventory/stockChecks/InventoryStockCheckResultSurface.jsx';
import { loadSubmittedStockCheck, loadStockCheckResult } from '../../inventory/stockChecks/inventoryStockCheckResultService.js';
const auth = { user: { id: 'admin' }, profile: { role_outlet_access_type: 'all' }, hasPermission: () => true };
const outlets = [{ id: 'outlet', name: 'QA Outlet' }];
const header = id => ({ id, outlet_id: 'outlet', status: 'submitted', stock_check_type: 'audit', check_date: '2026-09-24', submitted_by: 'employee', submitted_at: '2026-09-24T12:00:00Z' });
const rows = id => [{ id: `row-${id}`, stock_check_id: id, item_id: `item-${id}`, category_id: 'category', actual_count_quantity: 4, par_level_quantity: 10, variance: -6, unit_cost_snapshot: 7, unit: 'kg' }];
function fixture(table, options) {
  if (table === 'inventory_stock_checks') return { data: [header(options.eq.id)] };
  if (table === 'inventory_stock_check_items') return { data: rows(options.eq.stock_check_id) };
  if (table === 'inventory_items') return { data: options.in.id.map(id => ({ id, item_name: id, category_id: 'category', cost: 999, unit: 'pcs', photo_url: 'https://example.test/photo.jpg' })) };
  if (table === 'inventory_categories') return { data: [{ id: 'category', name: 'Frozen' }] };
  if (table === 'employees') return { data: [{ id: 'employee', full_name: 'QA Actor' }] };
  throw new Error(`Unexpected read ${table}`);
}
beforeEach(() => { read.mockReset().mockImplementation(async (table, options) => fixture(table, options)); });
afterEach(cleanup);
describe('identity-owned submitted result', () => {
  it('loads only identity-scoped evidence and label context, never mutable cost/Par', async () => {
    const data = await loadStockCheckResult('A', ['outlet']);
    expect(data.check.rows[0]).toMatchObject({ actualCount: 4, expectedQty: 10, variance: -6, unitCostSnapshot: 7, unit: 'kg' });
    expect(read).toHaveBeenCalledWith('inventory_stock_check_items', { eq: { stock_check_id: 'A' }, order: 'created_at' });
    expect(new Set(read.mock.calls.map(([table]) => table))).toEqual(new Set(['inventory_stock_checks', 'inventory_stock_check_items', 'inventory_items', 'inventory_categories', 'employees']));
  });
  it('rejects drafts and inaccessible outlets', async () => {
    await expect(loadStockCheckResult('A', ['other'])).rejects.toThrow('outside');
    read.mockResolvedValueOnce({ data: [{ ...header('A'), status: 'draft' }] });
    await expect(loadSubmittedStockCheck('A')).rejects.toThrow('Only submitted');
  });
  it.each(['incomplete', 'error'])('shows %s rather than partial results', async readState => {
    read.mockImplementation(async (table, options) => {
      if (table === 'inventory_stock_check_items') throw Object.assign(new Error('Cannot verify all rows'), { readState });
      return fixture(table, options);
    });
    render(<InventoryStockCheckResultSurface checkId="A" auth={auth} outlets={outlets} onClose={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Total Stock Value')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
  it('hides old identity while B is pending and ignores late A', async () => {
    let resolveA; let resolveB;
    const pendingA = new Promise(done => { resolveA = done; });
    const pendingB = new Promise(done => { resolveB = done; });
    read.mockImplementation(async (table, options) => table === 'inventory_stock_check_items' ? (options.eq.stock_check_id === 'A' ? pendingA : pendingB) : fixture(table, options));
    const view = render(<InventoryStockCheckResultSurface checkId="A" auth={auth} outlets={outlets} onClose={vi.fn()} />);
    await waitFor(() => expect(read).toHaveBeenCalledWith('inventory_stock_check_items', expect.objectContaining({ eq: { stock_check_id: 'A' } })));
    view.rerender(<InventoryStockCheckResultSurface checkId="B" auth={auth} outlets={outlets} onClose={vi.fn()} />);
    expect(screen.queryByText('item-A')).toBeNull();
    await act(async () => resolveB({ data: rows('B') }));
    await screen.findByText('item-B');
    await act(async () => resolveA({ data: rows('A') }));
    expect(screen.queryByText('item-A')).toBeNull();
    expect(screen.getByText('item-B')).toBeTruthy();
  });
  it('replaces a loaded identity only after verified current response and rejects scope changes', async () => {
    const view = render(<InventoryStockCheckResultSurface checkId="A" auth={auth} outlets={outlets} onClose={vi.fn()} />);
    await screen.findByText('item-A');
    let resolve;
    read.mockImplementation(async (table, options) => table === 'inventory_stock_check_items' ? new Promise(done => { resolve = done; }) : fixture(table, options));
    view.rerender(<InventoryStockCheckResultSurface checkId="B" auth={auth} outlets={outlets} onClose={vi.fn()} />);
    expect(screen.queryByText('item-A')).toBeNull();
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    view.rerender(<InventoryStockCheckResultSurface checkId="B" auth={{ ...auth, hasPermission: () => false }} outlets={outlets} onClose={vi.fn()} />);
    await screen.findByRole('alert');
    await act(async () => resolve({ data: rows('B') }));
    expect(screen.queryByText('item-B')).toBeNull();
  });
});
