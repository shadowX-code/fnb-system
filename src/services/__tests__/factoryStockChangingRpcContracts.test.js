import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), createAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: mocks.createAuditLog } }));
import { factoryService } from "../factoryService.js";

describe("Factory stock-changing trusted RPC contracts", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("maps receiving completion intent, including its request ID and batch fields, to the trusted receiving RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "receiving-1", batch_no: "RB-1", status: "completed", items: [] }, error: null });
    await factoryService.saveRawMaterialReceivingBatch({ completion_request_id: "receive-request", supplier_id: "supplier-1", reference_no: "PO-1", received_date: "2026-08-09", remarks: "ok", items: [{ raw_material_id: "rm-1", received_qty: 5, uom: "kg", storage_location_id: "loc-1", supplier_lot_no: "LOT-1", expiry_date: "2026-09-09", expiry_source: "calculated", expiry_confirmed: true }] }, { complete: true });
    expect(mocks.rpc).toHaveBeenCalledWith("factory_save_raw_material_receiving", expect.objectContaining({ p_request_id: "receive-request", p_supplier_id: "supplier-1", p_reference_no: "PO-1", p_complete: true, p_items: [expect.objectContaining({ raw_material_id: "rm-1", received_qty: 5, uom: "kg", storage_location_id: "loc-1", supplier_lot_no: "LOT-1", expiry_confirmed: true })] }));
  });

  it("maps dispatch allocation intent and its caller-owned request ID to the trusted complete RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "dispatch-1", dispatch_no: "D-1", status: "completed", items: [] }, error: null });
    await factoryService.saveAndCompleteFinishedGoodDispatch({ completion_request_id: "dispatch-request", customer_id: "customer-1", dispatch_date: "2026-08-09", items: [{ finished_good_id: "sku-1", quantity: 2, allocations: [{ batch_balance_id: "fg-batch-1", quantity: 2 }] }] });
    expect(mocks.rpc).toHaveBeenCalledWith("factory_save_and_complete_finished_good_dispatch", expect.objectContaining({ p_request_id: "dispatch-request", p_customer_id: "customer-1", p_items: [{ finished_good_id: "sku-1", quantity: 2, batch_no: "", remarks: "", allocations: [{ batch_balance_id: "fg-batch-1", quantity: 2 }] }] }));
  });

  it.each([["product", "factory_approve_product_stock_check"], ["raw", "factory_approve_raw_material_stock_check"]])("delegates %s stock-check approval to its trusted adjustment RPC", async (stockType, rpcName) => {
    mocks.rpc.mockResolvedValue({ error: null }); await factoryService.approveStockCheck(stockType, { id: "check-1", check_no: "SC-1" }, "employee-1");
    expect(mocks.rpc).toHaveBeenCalledWith(rpcName, { p_stock_check_id: "check-1", p_approved_by: null });
  });
});
