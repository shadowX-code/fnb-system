import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { read, rpc } = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }));
vi.mock('../../../../services/inventoryCompleteRead.js', () => ({ readCompleteInventoryRows: read }));
vi.mock('../../../../lib/supabase', () => ({ supabase: { rpc } }));
import InventoryStockCheckResultSurface from '../../inventory/stockChecks/InventoryStockCheckResultSurface.jsx';
import { loadSubmittedStockCheck, loadStockCheckResult } from '../../inventory/stockChecks/inventoryStockCheckResultService.js';
const auth = { user: { id: 'admin' }, profile: { role_outlet_access_type: 'all' }, hasPermission: () => true };
const outlets = [{ id: 'outlet', name: 'QA Outlet' }];
const header = id => ({ id, outlet_id: 'outlet', status: 'submitted', stock_check_type: 'audit', check_date: '2026-09-24', created_by_employee_id: 'creator', submitted_by: 'employee', submitted_at: '2026-09-24T12:00:00Z' });
const rows = id => [{ id: `row-${id}`, stock_check_id: id, item_id: `item-${id}`, category_id: 'category', actual_count_quantity: 4, par_level_quantity: 10, variance: -6, unit_cost_snapshot: 7, unit: 'kg' }];
function fixture(table, options) {
  if (table === 'inventory_stock_checks') return { data: [header(options.eq.id)] };
  if (table === 'inventory_stock_check_items') return { data: rows(options.eq.stock_check_id) };
  if (table === 'inventory_items') return { data: options.in.id.map(id => ({ id, item_name: id, category_id: 'category', cost: 999, unit: 'pcs', photo_url: 'https://example.test/photo.jpg' })) };
  if (table === 'inventory_categories') return { data: [{ id: 'category', name: 'Frozen' }] };
  if (table === 'employees') return { data: [{ id: 'employee', full_name: 'QA Submitter' }, { id: 'creator', nickname: 'QA Creator' }] };
  throw new Error(`Unexpected read ${table}`);
}
beforeEach(() => {
  read.mockReset().mockImplementation(async (table, options) => fixture(table, options));
  rpc.mockReset().mockImplementation(async (name, args) => {
    if (name !== 'inventory_audit_correction_history') throw new Error(`Unexpected RPC ${name}`);
    return { data: { entries: [{ id: args.p_check_id, version: 0, status: 'submitted', submitted_at: '2026-09-24T12:00:00Z' }] }, error: null };
  });
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });
describe('identity-owned submitted result', () => {
  it('loads only identity-scoped evidence and label context, never mutable cost/Par', async () => {
    const data = await loadStockCheckResult('A', ['outlet']);
    expect(data.actors).toEqual({ createdByName: 'QA Creator', submittedByName: 'QA Submitter' });
    expect(data.check.rows[0]).toMatchObject({ actualCount: 4, expectedQty: 10, variance: -6, unitCostSnapshot: 7, unit: 'kg' });
    expect(read).toHaveBeenCalledWith('inventory_stock_check_items', { eq: { stock_check_id: 'A' }, order: 'created_at' });
    expect(new Set(read.mock.calls.map(([table]) => table))).toEqual(new Set(['inventory_stock_checks', 'inventory_stock_check_items', 'inventory_items', 'inventory_categories', 'employees']));
  });
  it('rejects drafts and inaccessible outlets', async () => {
    await expect(loadStockCheckResult('A', ['other'])).rejects.toThrow('outside');
    read.mockResolvedValueOnce({ data: [{ ...header('A'), status: 'draft' }] });
    await expect(loadSubmittedStockCheck('A')).rejects.toThrow('Only submitted');
  });
  it('shows missing historical actuals as pending without projecting a stored variance', async () => {
    read.mockImplementation(async (table, options) => table === 'inventory_stock_check_items'
      ? { data: [{ ...rows('A')[0], actual_count_quantity: null }] } : fixture(table, options));
    render(<InventoryStockCheckResultSurface checkId="A" auth={auth} outlets={outlets} onClose={vi.fn()} />);
    const row = within(await screen.findByRole('row', { name: /item-A.*Pending/ }));
    expect(row.getAllByRole('cell')[1].textContent).toBe('10');
    expect(row.getAllByRole('cell')[2].textContent).toBe('—');
    expect(row.getAllByRole('cell')[3].textContent).toBe('—');
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

it('opens a linked correction draft and submits quantity zero with a reason through Stock Check', async () => {
  const sourceId = '00000000-0000-4000-8000-000000000001';
  const draftId = '00000000-0000-4000-8000-000000000002';
  let submitted = false;
  const source = { ...header(sourceId), audit_name: 'Spot Check' };
  const sourceRows = rows(sourceId);
  read.mockImplementation(async (table, options) => {
    if (table === 'inventory_stock_checks') return { data: [options.eq.id === sourceId ? source : {
      ...source, id: draftId, status: submitted ? 'submitted' : 'draft', correction_of_id: sourceId, audit_name: 'Spot Check · Correction',
    }] };
    if (table === 'inventory_stock_check_items') return { data: options.eq.stock_check_id === sourceId ? sourceRows : [{
      ...sourceRows[0], id: 'correction-row', actual_count_quantity: submitted ? 0 : 4,
    }] };
    return fixture(table, options);
  });
  rpc.mockImplementation(async (name, args) => {
    if (name === 'inventory_audit_correction_history') return { data: { entries: submitted ? [
      { ...source, version: 0 }, { ...source, id: draftId, version: 1, correction_reason: 'Verified zero' },
    ] : [{ ...source, version: 0 }] }, error: null };
    if (name === 'inventory_create_audit_correction') return { data: { check_id: draftId }, error: null };
    if (name === 'inventory_save_stock_check') { submitted = args.p_check.status === 'submitted'; return { data: {}, error: null }; }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const view = render(<InventoryStockCheckResultSurface checkId={sourceId} auth={auth} outlets={outlets} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Create Correction' }));
  await waitFor(() => expect(window.location.pathname).toContain(draftId));
  expect(rpc).toHaveBeenCalledWith('inventory_create_audit_correction', { p_check_id: sourceId, p_request_id: expect.any(String) });
  view.rerender(<InventoryStockCheckResultSurface checkId={draftId} auth={auth} outlets={outlets} onClose={vi.fn()} />);
  const draft = within(await screen.findByRole('dialog', { name: 'Audit Correction Draft' }));
  const input = draft.getByRole('spinbutton');
  const submit = draft.getByRole('button', { name: 'Submit Correction' });
  expect(input.value).toBe('4');
  fireEvent.change(input, { target: { value: '0' } });
  expect(draft.getByText('1 of 1 items affected')).toBeTruthy();
  expect(submit.disabled).toBe(true);
  fireEvent.change(draft.getByLabelText('Correction Reason'), { target: { value: 'Verified zero' } });
  fireEvent.click(submit);

  expect(await screen.findByText('Superseded evidence')).toBeTruthy();
  expect(screen.getByText('Current submitted evidence')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Source Count' })).toBeTruthy();
  expect(rpc).toHaveBeenCalledWith('inventory_save_stock_check', expect.objectContaining({
    p_check: expect.objectContaining({ id: draftId, status: 'submitted', correction_reason: 'Verified zero' }),
    p_items: [{ item_id: sourceRows[0].item_id, actual_count_quantity: 0, notes: '' }],
  }));
});

it('shows evidence to viewers without granting correction authoring', async () => {
  const viewer = { ...auth, hasPermission: (code) => code === 'inventory_stock_check.view' };
  render(<InventoryStockCheckResultSurface checkId="A" auth={viewer} outlets={outlets} onClose={vi.fn()} />);
  expect(await screen.findByText('Current submitted evidence')).toBeTruthy();
  expect(screen.getByText(/Stock Check edit and submit permissions/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create Correction' })).toBeNull();
});

it.each(['draft', 'submitted'])('opens an existing %s correction from its source without creating another', async status => {
  const entries = [
    { id: 'A', status: 'submitted', version: 0 },
    { id: 'B', status, version: 1, correction_of_id: 'A' },
  ].map(entry => ({ created_at: '2026-09-24T12:00:00Z', ...entry }));
  rpc.mockResolvedValue({ data: { entries } });
  const viewer = { ...auth, hasPermission: code => code === 'inventory_stock_check.view' };
  render(<InventoryStockCheckResultSurface checkId="A" auth={status === 'draft' ? auth : viewer} outlets={outlets} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'View Correction', exact: true }));
  expect(window.location.pathname).toBe('/restaurant/inventory/stock-check/results/B');
  expect(screen.queryByRole('button', { name: 'Create Correction' })).toBeNull();
  expect(rpc).toHaveBeenCalledTimes(1);
});

it.each([null, '2026-08-01'])('offers a fresh closing setup with only recorded scope and month (%s)', async month => {
  read.mockImplementation(async (table, options) => table === 'inventory_stock_checks'
    ? { data: [{ ...header('A'), audit_type: 'Month-End Closing', accounting_month: month }] } : fixture(table, options));
  const blocked = 'This closing lacks a complete frozen roster, count units or pinned costs.';
  rpc.mockImplementation(async name => ({ data: name === 'inventory_audit_correction_history'
    ? { blocked_reason: blocked, entries: [{ id: 'A', status: 'submitted', version: 0, created_at: '2026-09-24T12:00:00Z' }] } : null }));
  const viewer = { ...auth, hasPermission: code => code === 'inventory_stock_check.view' };
  const view = render(<InventoryStockCheckResultSurface checkId="A" auth={viewer} outlets={outlets} onClose={vi.fn()} />);
  expect(await screen.findByText(blocked)).toBeTruthy();
  expect(screen.getByText(/Stock Check submit permission is required to start/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start New Closing Audit' })).toBeNull();
  view.rerender(<InventoryStockCheckResultSurface checkId="A" auth={auth} outlets={outlets} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Start New Closing Audit' }));
  const query = new URLSearchParams(window.location.search);
  expect(query.get('outletId')).toBe('outlet');
  expect(query.get('accountingMonth')).toBe(month?.slice(0, 7) ?? null);
  expect(query.has('date')).toBe(false);
});
