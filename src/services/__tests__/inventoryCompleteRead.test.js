import { beforeEach, describe, expect, it, vi } from "vitest";
const range = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const order = vi.hoisted(() => vi.fn());
const eq = vi.hoisted(() => vi.fn());
const inFilter = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => ({ select }) } }));
import { readCompleteInventoryRows } from "../inventoryCompleteRead.js";
beforeEach(() => {
  range.mockReset(); select.mockReset(); order.mockReset(); eq.mockReset(); inFilter.mockReset();
  const query = { order, range, eq, in: inFilter };
  select.mockReturnValue(query); order.mockReturnValue(query);
  eq.mockReturnValue(query);
  inFilter.mockReturnValue(query);
});
const rows = (start, count) => Array.from({ length: count }, (_, i) => ({ id: `id-${start + i}` }));
describe("complete Inventory reads", () => {
  it("reads every submitted Stock Check row with identity scope and stable ordering", async () => {
    range.mockResolvedValueOnce({ data: rows(0, 500), count: 501 }).mockResolvedValueOnce({ data: rows(500, 1), count: 501 });
    const result = await readCompleteInventoryRows("inventory_stock_check_items", { eq: { stock_check_id: "check-A" }, order: "created_at" });
    expect(result.data).toHaveLength(501);
    expect(eq.mock.calls).toEqual([["stock_check_id", "check-A"], ["stock_check_id", "check-A"]]);
    expect(order.mock.calls).toEqual([["created_at", { ascending: true }], ["id", { ascending: true }], ["created_at", { ascending: true }], ["id", { ascending: true }]]);
  });
  it("retains receipt identity scope across every complete-read page", async () => {
    range.mockResolvedValueOnce({ data: rows(0, 500), count: 501 }).mockResolvedValueOnce({ data: rows(500, 1), count: 501 });
    await readCompleteInventoryRows("inventory_purchase_receipt_items", { in: { receipt_id: ["receipt-a", "receipt-b"] } });
    expect(inFilter.mock.calls).toEqual([["receipt_id", ["receipt-a", "receipt-b"]], ["receipt_id", ["receipt-a", "receipt-b"]]]);
  });
  it('retains identical outlet/reference scope on every exact-count page', async () => {
    range.mockResolvedValueOnce({ data: rows(0, 500), count: 501 }).mockResolvedValueOnce({ data: rows(500, 1), count: 501 });
    await readCompleteInventoryRows('inventory_movements', { eq: { outlet_id: 'outlet', reference_type: 'waste' } });
    expect(eq.mock.calls).toEqual([['outlet_id', 'outlet'], ['reference_type', 'waste'], ['outlet_id', 'outlet'], ['reference_type', 'waste']]);
  });
  it("loads beyond the server row cap with stable ordering and exact count", async () => {
    range.mockResolvedValueOnce({ data: rows(0, 500), count: 1201 }).mockResolvedValueOnce({ data: rows(500, 500), count: 1201 }).mockResolvedValueOnce({ data: rows(1000, 201), count: 1201 });
    const result = await readCompleteInventoryRows("inventory_movements", { order: "created_at", ascending: false });
    expect(result.data).toHaveLength(1201);
    expect(result.completeness).toBe("complete");
    expect(select).toHaveBeenCalledWith("*", { count: "exact" });
    expect(order).toHaveBeenCalledWith("id", { ascending: true });
  });
  it("allows verified empty, not a read failure", async () => {
    range.mockResolvedValue({ data: [], count: 0 });
    expect((await readCompleteInventoryRows("inventory_items")).data).toEqual([]);
  });
  it("rejects truncation instead of returning partial evidence", async () => {
    range.mockResolvedValue({ data: rows(0, 100), count: 501 });
    await expect(readCompleteInventoryRows("inventory_items")).rejects.toMatchObject({ readState: "incomplete" });
  });
  it("rejects read errors instead of turning them into an empty array", async () => {
    range.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(readCompleteInventoryRows("inventory_items")).rejects.toMatchObject({ readState: "error" });
  });
  it("rejects changed counts and overlapping pages", async () => {
    range.mockResolvedValueOnce({ data: rows(0, 500), count: 501 }).mockResolvedValueOnce({ data: rows(499, 1), count: 501 });
    await expect(readCompleteInventoryRows("inventory_items")).rejects.toMatchObject({ readState: "incomplete" });
    range.mockResolvedValueOnce({ data: rows(0, 500), count: 501 }).mockResolvedValueOnce({ data: rows(500, 2), count: 502 });
    await expect(readCompleteInventoryRows("inventory_items")).rejects.toMatchObject({ readState: "incomplete" });
  });
});
