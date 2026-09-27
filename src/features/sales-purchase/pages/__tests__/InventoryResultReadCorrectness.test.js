import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Exercise the actual legacy coordinator without bootstrapping unrelated routes.
const source = readFileSync('src/features/sales-purchase/pages/InventoryControlPage.jsx', 'utf8');
function coordinator(read) {
  const start = source.indexOf('  async function hydrateStockCheckRows(');
  const end = source.indexOf('  async function createDraftPurchaseOrders(', start);
  const resultRequest = { current: 0 };
  let data = { checks: [{ id: 'A', rows: ['frozen A'] }, { id: 'B', rows: ['frozen B'] }], orders: [] };
  let modal = null;
  const notify = vi.fn();
  const setData = fn => { data = fn(data); };
  const updateModal = value => { modal = value; };
  const setModal = value => { resultRequest.current += 1; updateModal(value); };
  const functions = new Function('readCompleteInventoryRows', 'mapRemoteStockCheckItem', 'resultRequest', 'setData', 'setModal', 'updateModal', 'buildPurchaseSuggestions', 'notify', 'debugLog', 'fetchRemotePurchaseOrdersForStockCheck', `${source.slice(start, end)}; return { openStockCheckResult, openPurchaseSuggestionsForCheck };`)(read, row => row, resultRequest, setData, setModal, updateModal, () => [], notify, () => {}, async () => []);
  return { ...functions, notify, getData: () => data, getModal: () => modal, cancel: () => { resultRequest.current += 1; } };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
describe('Stock Check Result verified replacement', () => {
  it('uses the scoped complete reader and preserves frozen row values', async () => {
    const rows = [{ id: 'row', actual: 4, par: 10, unitCostSnapshot: 7 }];
    const read = vi.fn().mockResolvedValue({ data: rows, completeness: 'complete' });
    const owner = coordinator(read);
    await owner.openStockCheckResult({ id: 'A', stockCheckType: 'audit' });
    expect(read).toHaveBeenCalledWith('inventory_stock_check_items', { eq: { stock_check_id: 'A' }, order: 'created_at' });
    expect(owner.getModal().stockCheck.rows).toEqual(rows);
  });
  it.each(['incomplete', 'error'])('does not replace evidence on %s', async readState => {
    const owner = coordinator(vi.fn().mockRejectedValue(Object.assign(new Error('read failed'), { readState })));
    await owner.openStockCheckResult({ id: 'A' });
    expect(owner.getData().checks[0].rows).toEqual(['frozen A']);
    expect(owner.getModal()).toBeNull();
    expect(owner.notify).toHaveBeenCalled();
  });
  it('rejects late Result A after Result B and rejects responses after scope cancellation', async () => {
    const a = deferred(); const b = deferred(); const c = deferred();
    const owner = coordinator(vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise));
    const first = owner.openStockCheckResult({ id: 'A' });
    const second = owner.openStockCheckResult({ id: 'B' });
    b.resolve({ data: [{ id: 'B row' }] }); await second;
    a.resolve({ data: [{ id: 'stale A' }] }); await first;
    expect(owner.getModal().stockCheck.id).toBe('B');
    expect(owner.getData().checks[0].rows).toEqual(['frozen A']);
    const cancelled = owner.openStockCheckResult({ id: 'A' }); owner.cancel();
    c.resolve({ data: [{ id: 'cancelled' }] }); await cancelled;
    expect(owner.getModal()).toBeNull();
  });
});
