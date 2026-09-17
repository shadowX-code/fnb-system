import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: vi.fn() } }));
import { factoryService } from "../factoryService.js";

describe("Factory Internal Transfer trusted RPC contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the canonical batch inventory authority for a source Location", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ batch_balance_id: "batch-1", quantity: 4 }], error: null });
    await expect(factoryService.getInternalTransferInventory("raw_material", "location-1")).resolves.toEqual([{ batch_balance_id: "batch-1", quantity: 4 }]);
    expect(mocks.rpc).toHaveBeenCalledWith("factory_internal_transfer_inventory", { p_inventory_type: "raw_material", p_location_id: "location-1" });
  });

  it("submits one request-idempotent transfer document through the trusted authority", async () => {
    mocks.rpc.mockResolvedValue({ data: { transfer: { transfer_no: "TR260918-01" } }, error: null });
    await factoryService.completeInternalTransfer({ inventory_type: "finished_good", from_location_id: "from", to_location_id: "to", items: [{ batch_balance_id: "batch-1", quantity: 2 }] }, "request-1");
    expect(mocks.rpc).toHaveBeenCalledWith("factory_complete_internal_transfer", expect.objectContaining({ p_request_id: "request-1", p_transfer: expect.objectContaining({ inventory_type: "finished_good", items: [{ batch_balance_id: "batch-1", quantity: 2 }] }) }));
  });
});
