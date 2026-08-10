import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), createAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: mocks.createAuditLog } }));
import { factoryService } from "../factoryService.js";

const production = { job_order_id: "job-1", production_no: "PRD-1", completion_request_id: "request-stable-1", end_date: "2026-08-09", end_time: "10:00", actual_pack_qty: 4, actual_output_qty: 2, uom: "kg", notes: "done", material_usage: [{ raw_material_id: "rm-1", standard_usage: 2, actual_usage: 2, uom: "kg", allocations: [{ batch_balance_id: "batch-1", allocated_qty: 2 }] }] };
function chain(result) { const value = { select: () => value, eq: () => value, single: () => Promise.resolve(result) }; return value; }
describe("Factory Production completion trusted RPC contract", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.from.mockImplementation((table) => table === "factory_job_orders" ? chain({ data: { id: "job-1", production_date: "2026-08-09", start_time: "08:00" }, error: null }) : chain({ data: null, error: { message: "read back unavailable" } })); });
  it("maps the supplied stable completion request ID and allocation intent into one trusted RPC", async () => {
    vi.spyOn(factoryService, "getProductionExecution").mockResolvedValue({ snapshotCreatedAt: "", steps: [] }); mocks.rpc.mockResolvedValue({ data: "production-1", error: null });
    const result = await factoryService.completeProduction(production);
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledWith("factory_complete_production_with_raw_batch_allocations", { p_request_id: "request-stable-1", p_payload: { job_order_id: "job-1", finished_good_id: null, production_no: "PRD-1", batch_no: "", end_date: "2026-08-09", end_time: "10:00", expiry_date: null, storage_location_id: null, expiry_override_reason: null, actual_pack_qty: 4, actual_output_qty: 2, uom: "kg", notes: "done", usage_items: [{ raw_material_id: "rm-1", standard_usage: 2, actual_usage: 2, variance_reason: "", uom: "kg", wastage_quantity: 0, notes: "", allocations: [{ batch_balance_id: "batch-1", allocated_qty: 2 }] }] } });
    expect(result).toEqual({ id: "production-1", completion_request_id: "request-stable-1", status: "completed" });
  });
});
