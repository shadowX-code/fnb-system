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

  it("uses the canonical Finished Goods batch-availability authority without recreating stock calculations", async () => {
    mocks.rpc.mockResolvedValue({ data: {
      finished_good_id: "sku-1", aggregate_balance: 35, allocatable_batch_balance: 16, unavailable_balance: 19,
      batches: [{ batch_id: "batch-eligible", available_qty: 16, storage_location: "Freezer Store-A", storage_location_status: "active" }],
      unavailable_batches: [{ batch_id: "batch-unmapped", unavailable_qty: 19, exclusion_reason: "Storage Location Missing" }],
    }, error: null });

    const availability = await factoryService.getFinishedGoodBatchAvailability({
      finishedGoodId: "sku-1", dispatchDate: "2026-09-05",
    });

    expect(mocks.rpc).toHaveBeenCalledWith("factory_get_finished_good_batch_availability", {
      p_finished_good_id: "sku-1", p_dispatch_id: null, p_dispatch_date: "2026-09-05",
    });
    expect(availability).toMatchObject({ aggregate_balance: 35, allocatable_batch_balance: 16, unavailable_balance: 19 });
    expect(availability.batches).toEqual([expect.objectContaining({ batch_id: "batch-eligible", available_qty: 16 })]);
    expect(availability.unavailable_batches).toEqual([expect.objectContaining({ batch_id: "batch-unmapped", exclusion_reason: "Storage Location Missing" })]);
  });

  it.each([["product", "factory_approve_product_stock_check"], ["raw", "factory_approve_raw_material_stock_check"]])("delegates %s stock-check approval to its trusted adjustment RPC", async (stockType, rpcName) => {
    mocks.rpc.mockResolvedValue({ error: null }); await factoryService.approveStockCheck(stockType, { id: "check-1", check_no: "SC-1" }, "employee-1");
    expect(mocks.rpc).toHaveBeenCalledWith(rpcName, { p_stock_check_id: "check-1", p_approved_by: null });
  });

  it("maps MeSTI Cleaning completion and verification to trusted RPCs", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "occ-1", status: "completed" }, error: null });
    await factoryService.completeMestiCleaningOccurrence("occ-1", "done");
    expect(mocks.rpc).toHaveBeenCalledWith("factory_mesti_complete_cleaning_occurrence", { p_occurrence_id: "occ-1", p_note: "done" });

    await factoryService.verifyMestiCleaningOccurrence("occ-1", "verified", "ok");
    expect(mocks.rpc).toHaveBeenCalledWith("factory_mesti_verify_cleaning_occurrence", { p_occurrence_id: "occ-1", p_result: "verified", p_note: "ok" });
  });

  it("delegates Receiving verification to its document-level trusted RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "receiving-1", batch_no: "RB-1", status: "completed", verification_status: "verified", items: [] }, error: null });
    await factoryService.verifyRawMaterialReceivingBatch({ id: "receiving-1", batch_no: "RB-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("factory_verify_raw_material_receiving", { p_batch_id: "receiving-1" });
  });
  it("delegates Production verification to its trusted record authority", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: "production-1", verification_status: "verified" }, error: null });
    await factoryService.verifyProductionRecord({ id: "production-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("factory_verify_production_record", { p_production_id: "production-1" });
  });

  it("uses the Food Processing projection's declared filter signature", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await factoryService.listMestiFoodProcessingControl({
      dateFrom: "2026-09-01", dateTo: "2026-09-04", product: "11111111-1111-4111-8111-111111111111", qcStatus: "Passed", verificationStatus: "verified", search: "PRD-1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("factory_mesti_food_processing_control", {
      p_date_from: "2026-09-01", p_date_to: "2026-09-04", p_finished_good_id: "11111111-1111-4111-8111-111111111111", p_qc_status: "Passed", p_verification_status: "verified", p_search: "PRD-1",
    });
  });

  it("maps MeSTI Cleaning requirements to its trusted authority without role settings", async () => {
    const requirement = { task_name: "Floor", location_ids: ["loc-1", "loc-2"], recurrence_type: "daily" };
    mocks.rpc.mockResolvedValue({ data: { id: "req-1", ...requirement, location_names: ["Cooking", "Dry Store"] }, error: null });
    await factoryService.saveMestiCleaningRequirement(requirement);
    expect(mocks.rpc).toHaveBeenCalledWith("factory_save_mesti_cleaning_requirement", { p_requirement: requirement });

    expect(factoryService.saveMestiCleaningSettings).toBeUndefined();
  });
});
