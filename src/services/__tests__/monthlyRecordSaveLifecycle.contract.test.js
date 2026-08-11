import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("../auditLogService.js", () => ({ auditLogService: { createAuditLog: mocks.audit } }));

import { salesRecordService } from "../salesRecordService.js";
import { purchaseRecordService } from "../purchaseRecordService.js";

function query(result, calls) {
  const chain = {};
  ["select", "eq", "order", "upsert", "delete", "in", "update", "insert", "single"].forEach((method) => {
    chain[method] = vi.fn((...args) => { calls.push([method, ...args]); return chain; });
  });
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function queueQueries(...responses) {
  const calls = [];
  mocks.from.mockImplementation((table) => {
    calls.push(["from", table]);
    return query(responses.shift(), calls);
  });
  return calls;
}

const outletId = "outlet-1";
const existingSales = [
  { id: "sale-keep", outlet_id: outletId, year: 2026, month: 8, channel_id: "channel-keep", channel_name: "Dine In", amount: 100 },
  { id: "sale-update", outlet_id: outletId, year: 2026, month: 8, channel_id: "channel-update", channel_name: "Delivery", amount: 50 },
  { id: "sale-remove", outlet_id: outletId, year: 2026, month: 8, channel_id: "channel-remove", channel_name: "Legacy", amount: 20 },
];
const existingPurchase = [
  { id: "purchase-update", outlet_id: outletId, year: 2026, month: 8, supplier_id: "supplier-1", category_id: "category-1", amount: 50, supplier: { name: "Fresh" }, category: { name: "Produce" } },
  { id: "purchase-remove", outlet_id: outletId, year: 2026, month: 8, supplier_id: "supplier-2", category_id: "category-2", amount: 20, supplier: { name: "Old" }, category: { name: "Dry" } },
];

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("monthly Sales and Purchase save authority", () => {
  it("Sales sends the complete intended period to the transactional snapshot RPC and audits only after canonical success", async () => {
    const saved = [
      { ...existingSales[0], updated_at: "now" },
      { ...existingSales[1], amount: 75, updated_at: "now" },
      { id: "sale-new", outlet_id: outletId, year: 2026, month: 8, channel_id: "channel-new", channel_name: "Other", amount: 25, updated_at: "now" },
    ];
    mocks.rpc.mockResolvedValueOnce({ data: { records: saved }, error: null });
    await expect(salesRecordService.saveSalesRecords(outletId, 2026, 8, [
      { channel_id: "channel-keep", channel_name: "Dine In", amount: 100 },
      { channel_id: "channel-update", channel_name: "Delivery", amount: 75 },
      { channel_id: "channel-new", channel_name: "Other", amount: 25 },
    ], "00000000-0000-4000-8000-000000000001")).resolves.toEqual(saved);
    expect(mocks.rpc).toHaveBeenCalledWith("save_sales_period_snapshot", {
      p_request_id: "00000000-0000-4000-8000-000000000001",
      p_outlet_id: outletId,
      p_year: 2026,
      p_month: 8,
      p_rows: [
        { channel_id: "channel-keep", channel_name: "Dine In", amount: 100, remark: "" },
        { channel_id: "channel-update", channel_name: "Delivery", amount: 75, remark: "" },
        { channel_id: "channel-new", channel_name: "Other", amount: 25, remark: "" },
      ],
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sales_updated", outlet: outletId, after: { rows: 3 } }));
  });

  it("Sales surfaces an RPC rejection without auditing or starting a direct write path", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("snapshot rejected") });
    await expect(salesRecordService.saveSalesRecords(outletId, 2026, 8, existingSales.slice(0, 2), "00000000-0000-4000-8000-000000000002")).rejects.toThrow("snapshot rejected");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("Sales treats an audit failure as best effort after snapshot persistence and preserves a request ID for an ambiguous retry", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    const saved = [{ id: "sale-new", outlet_id: outletId, year: 2026, month: 8, channel_id: "channel-new", channel_name: "Other", amount: 25 }];
    mocks.rpc.mockResolvedValue({ data: { records: saved }, error: null });
    const requestId = "00000000-0000-4000-8000-000000000003";
    await expect(salesRecordService.saveSalesRecords(outletId, 2026, 8, [{ channel_id: "channel-new", channel_name: "Other", amount: 25 }], requestId)).resolves.toEqual(saved);
    await expect(salesRecordService.saveSalesRecords(outletId, 2026, 8, [{ channel_id: "channel-new", channel_name: "Other", amount: 25 }], requestId)).resolves.toEqual(saved);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_request_id)).toEqual([requestId, requestId]);
  });

  it("Purchase updates existing rows one-by-one, inserts new rows one-by-one, deletes omitted rows, then audits", async () => {
    const updated = { ...existingPurchase[0], amount: 75, updated_at: "now" };
    const inserted = { id: "purchase-new", outlet_id: outletId, year: 2026, month: 8, supplier_id: "supplier-3", category_id: "category-3", amount: 25, supplier_name: "New", category_name: "Frozen" };
    mocks.rpc.mockResolvedValueOnce({ data: { records: [updated, inserted] }, error: null });
    const result = await purchaseRecordService.savePurchaseRecords(outletId, 2026, 8, [
      { id: "purchase-update", supplier_id: "supplier-1", category_id: "category-1", amount: 75 },
      { supplier_id: "supplier-3", category_id: "category-3", amount: 25 },
    ]);
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ id: "purchase-update", amount: 75 }), expect.objectContaining({ id: "purchase-new", amount: 25 })]));
    expect(mocks.rpc).toHaveBeenCalledWith("save_purchase_period_snapshot", expect.objectContaining({ p_outlet_id: outletId, p_year: 2026, p_month: 8, p_rows: expect.arrayContaining([expect.objectContaining({ supplier_id: "supplier-3", category_id: "category-3", amount: 25 })]) }));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "purchase_updated", outlet: outletId, after: { rows: 2 } }));
  });

  it("Purchase stops after a later row failure, leaving earlier direct writes persisted and the removed-row delete/audit unattempted", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("snapshot rejected") });
    await expect(purchaseRecordService.savePurchaseRecords(outletId, 2026, 8, [
      { id: "purchase-update", supplier_id: "supplier-1", category_id: "category-1", amount: 75 },
      { supplier_id: "supplier-3", category_id: "category-3", amount: 25 },
    ], "00000000-0000-4000-8000-000000000004")).rejects.toThrow("snapshot rejected");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
