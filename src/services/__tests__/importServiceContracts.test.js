import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn() }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("../auditLogService.js", () => ({ auditLogService: { createAuditLog: mocks.audit } }));

import { importService } from "../importService.js";

const sales = { sourceRow: 2, outlet_id: "outlet-1", outletCode: "KLC", outletName: "KL Central", year: 2026, month: 8, channel_id: "channel-1", channel_name: "Dine In", amount: 1200, remark: "Imported" };
const purchase = { sourceRow: 2, outlet_id: "outlet-1", outletCode: "KLC", outletName: "KL Central", year: 2026, month: 8, supplier_id: "supplier-1", supplier_name: "Fresh Foods", category_id: "category-1", category_name: "Produce", amount: 450, remark: "Invoice" };

function rpcResponses(...responses) {
  responses.forEach((data) => mocks.rpc.mockResolvedValueOnce({ data, error: null }));
}

beforeEach(() => { mocks.rpc.mockReset(); mocks.audit.mockReset().mockResolvedValue(undefined); });

describe("trusted Sales/Purchase import service contracts", () => {
  it("begins the existing logical Purchase request before request-bound master preparation and returns canonical mappings", async () => {
    rpcResponses(
      { batch: { id: "batch-2", request_id: "request-2" }, reused: false },
      { request_id: "request-2", categories: { Produce: "category-1" }, suppliers: { "Fresh Foods": "supplier-1" } },
    );
    await expect(importService.preparePurchaseMasters({ requestId: "request-2", fileName: "purchases.csv", records: [purchase], categories: [{ source_key: "Produce", name: "Produce" }], suppliers: [{ source_key: "Fresh Foods", name: "Fresh Foods", category_source_key: "Produce", outlet_id: "outlet-1" }] })).resolves.toMatchObject({ requestId: "request-2", categories: { Produce: "category-1" } });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["import_begin_request", "import_prepare_purchase_masters"]);
  });

  it("reuses the same request and canonical master mappings when Purchase preparation is retried", async () => {
    rpcResponses(
      { batch: { id: "batch-2", request_id: "request-2" }, reused: true },
      { request_id: "request-2", categories: { Produce: "category-1" }, suppliers: { "Fresh Foods": "supplier-1" } },
    );
    const request = { requestId: "request-2", fileName: "purchases.csv", records: [purchase], categories: [{ source_key: "Produce", name: "Produce" }], suppliers: [{ source_key: "Fresh Foods", name: "Fresh Foods", category_source_key: "Produce", outlet_id: "outlet-1" }] };
    await expect(importService.preparePurchaseMasters(request)).resolves.toEqual(expect.objectContaining({ requestId: "request-2", categories: { Produce: "category-1" }, suppliers: { "Fresh Foods": "supplier-1" } }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "import_begin_request", expect.objectContaining({ p_request_id: "request-2", p_import_type: "purchase" }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "import_prepare_purchase_masters", expect.objectContaining({ p_request_id: "request-2", p_categories: request.categories, p_suppliers: request.suppliers }));
  });

  it("maps a Sales request, canonical row intent, and server finalization through the only active authority", async () => {
    rpcResponses(
      { batch: { id: "batch-1", request_id: "request-1" }, reused: false },
      { success: true, row_request_key: "sales:outlet-1:2026:8:channel-1", action: "create", record: { id: "sales-1" } },
      { batch: { id: "batch-1", status: "completed" }, created: 1, updated: 0, failed: 0 },
    );
    const result = await importService.importSales({ fileName: "sales.csv", records: [sales], requestId: "request-1" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["import_begin_request", "import_apply_sales_row", "import_finalize_batch"]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "import_begin_request", expect.objectContaining({ p_request_id: "request-1", p_import_type: "sales", p_payload: expect.objectContaining({ source_filename: "sales.csv", targets: [["outlet-1", 2026, 8, "channel-1"]] }) }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "import_apply_sales_row", expect.objectContaining({ p_request_id: "request-1", p_payload: expect.objectContaining({ outlet_id: "outlet-1", channel_id: "channel-1", source_row: 2 }) }));
    expect(result).toMatchObject({ requestId: "request-1", createdCount: 1, failedCount: 0, savedRows: [expect.objectContaining({ id: "sales-1" })] });
  });

  it("maps Purchase through its supplier/category row authority without client target upsert or history insertion", async () => {
    rpcResponses(
      { batch: { id: "batch-2", request_id: "request-2" }, reused: false },
      { success: true, row_request_key: "purchase:outlet-1:2026:8:supplier-1:category-1", action: "update", record: { id: "purchase-1" } },
      { batch: { id: "batch-2", status: "completed" }, created: 0, updated: 1, failed: 0 },
    );
    await importService.importPurchases({ fileName: "purchases.csv", records: [purchase], requestId: "request-2" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["import_begin_request", "import_apply_purchase_row", "import_finalize_batch"]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "import_apply_purchase_row", expect.objectContaining({ p_payload: expect.objectContaining({ supplier_id: "supplier-1", category_id: "category-1" }) }));
  });

  it("reuses the caller-stable request ID for a retry; prior successful rows are resolved by the server rather than a second browser lifecycle", async () => {
    rpcResponses(
      { batch: { id: "batch-1", request_id: "request-1" }, reused: true },
      { success: true, row_request_key: "sales:outlet-1:2026:8:channel-1", action: "create", record: { id: "sales-1" } },
      { batch: { id: "batch-1", status: "completed" }, created: 1, updated: 0, failed: 0 },
    );
    await importService.importSales({ fileName: "sales.csv", records: [sales], requestId: "request-1" });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "import_begin_request", expect.objectContaining({ p_request_id: "request-1" }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "import_finalize_batch", { p_request_id: "request-1" });
  });

  it("returns mixed authoritative row outcomes and a reconciled partial batch without treating row failure as a browser lifecycle exception", async () => {
    rpcResponses(
      { batch: { id: "batch-1", request_id: "request-1" }, reused: false },
      { success: true, action: "create", record: { id: "sales-1" } },
      { success: false, row_request_key: "sales:failed", error: "row rejected" },
      { batch: { id: "batch-1", status: "partial_failed" }, created: 1, updated: 0, failed: 1 },
    );
    const result = await importService.importSales({ fileName: "sales.csv", records: [sales, { ...sales, channel_id: "channel-2" }], requestId: "request-1" });
    expect(result).toMatchObject({ createdCount: 1, failedCount: 1, batch: { status: "partial_failed" }, savedRows: [expect.objectContaining({ id: "sales-1" })] });
  });

  it("propagates trusted RPC rejection without fallback direct CRUD and leaves audit best effort only after authoritative finalization", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("request rejected") });
    await expect(importService.importSales({ fileName: "sales.csv", records: [sales], requestId: "request-1" })).rejects.toThrow("request rejected");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
