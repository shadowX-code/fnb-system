import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), operations: [] }));

function deleteQuery(table) {
  const operation = { table, method: "delete", filters: [] };
  const chain = {
    delete() { return chain; },
    eq(column, value) { operation.filters.push([column, value]); return chain; },
    then(resolve, reject) { mocks.operations.push(operation); return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
  };
  return chain;
}

vi.mock("../../lib/supabase.ts", () => ({
  supabase: { rpc: mocks.rpc, from: vi.fn((table) => deleteQuery(table)) },
}));
vi.mock("../auditLogService.js", () => ({ auditLogService: { createAuditLog: mocks.audit } }));

import { productAnalyticsService } from "../productAnalyticsService.js";

const report = {
  id: "report-new", outlet_id: "outlet-1", report_month: 7, report_year: 2026, file_name: "july.csv",
  uploaded_by: "server-user", uploaded_at: "2026-08-10T00:00:00.000Z", status: "completed", total_net_sales: 155,
  total_quantity: 12, total_discount: 5, raw_metadata: { source: "pos" },
};
const items = [
  { category_name: "Food", product_name: "Nasi Lemak", variant_name: "Regular", quantity: 10, gross_sales: 120, discount: 5, sst: 0, service_charge: 0, nett_sales: 115 },
  { category_name: "Drinks", product_name: "Teh Tarik", quantity: 2, gross_sales: 40, discount: 0, sst: 0, service_charge: 0, nett_sales: 40 },
];
function payload(overrides = {}) {
  return { outletId: "outlet-1", month: 7, year: 2026, fileName: "july.csv", items, existingReportId: "report-old", requestId: "report-request-1", metadata: { source: "pos" }, ...overrides };
}

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: { report }, error: null });
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.operations.length = 0;
});

describe("Product Analytics trusted upload RPC contracts", () => {
  it("sends replacement intent, canonical period payload, item rows, and request ID to one RPC", async () => {
    await expect(productAnalyticsService.replaceReport(payload())).resolves.toEqual(expect.objectContaining({ id: "report-new", uploaded_by: "server-user", total_net_sales: 155 }));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("product_analytics_save_report", {
      p_request_id: "report-request-1", p_operation: "replace",
      p_payload: {
        outlet_id: "outlet-1", report_month: 7, report_year: 2026, file_name: "july.csv",
        total_net_sales: 155, total_quantity: 12, total_discount: 5, raw_metadata: { source: "pos" },
      },
      p_items: [
        { ...items[0] },
        { ...items[1], variant_name: null },
      ],
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "product_sales_report_replaced", after: expect.objectContaining({ request_id: "report-request-1" }) }));
  });

  it("uses new-upload intent without a frontend actor or existing-report ID", async () => {
    await productAnalyticsService.replaceReport(payload({ existingReportId: null, requestId: "report-request-new" }));
    const [, request] = mocks.rpc.mock.calls[0];
    expect(request.p_operation).toBe("new");
    expect(request.p_payload).not.toHaveProperty("uploaded_by");
    expect(request.p_payload).not.toHaveProperty("existing_report_id");
  });

  it("surfaces trusted RPC rejection without any browser delete/header/item write path or audit", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("trusted transaction rejected") });
    await expect(productAnalyticsService.replaceReport(payload())).rejects.toThrow("trusted transaction rejected");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.operations).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("reuses the supplied request ID for an ambiguous-network retry", async () => {
    await productAnalyticsService.replaceReport(payload({ requestId: "stable-request" }));
    await productAnalyticsService.replaceReport(payload({ requestId: "stable-request" }));
    expect(mocks.rpc.mock.calls.map(([, request]) => request.p_request_id)).toEqual(["stable-request", "stable-request"]);
  });

  it("keeps a trusted save successful when its best-effort audit write fails", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(productAnalyticsService.replaceReport(payload())).resolves.toEqual(expect.objectContaining({ id: "report-new" }));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit report deletion as its separate single-delete plus best-effort audit path", async () => {
    await expect(productAnalyticsService.deleteReport({ ...report, id: "report-delete" })).resolves.toBe(true);
    expect(mocks.operations).toEqual([expect.objectContaining({ table: "product_sales_reports", method: "delete", filters: [["id", "report-delete"]] })]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "product_sales_report_deleted" }));
  });
});
