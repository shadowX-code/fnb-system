import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), createAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: mocks.createAuditLog } }));
import { factoryService } from "../factoryService.js";

describe("Factory Supplier Raw Material eligibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the canonical linked-only eligibility authority for new Receiving", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ raw_material_id: "rm-1", material_code: "CHI", name: "Chili", uom: "kg", is_linked: true }], error: null });

    const materials = await factoryService.getFactorySupplierRawMaterialEligibility("supplier-1");

    expect(mocks.rpc).toHaveBeenCalledWith("factory_supplier_raw_material_eligibility", { p_supplier_id: "supplier-1", p_linked_only: true });
    expect(materials).toEqual([expect.objectContaining({ id: "rm-1", material_code: "CHI", is_linked: true })]);
  });

  it("uses the same authority for Supplier link management and saves selected IDs atomically", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ raw_material_id: "rm-1", material_code: "CHI", name: "Chili", uom: "kg", is_linked: true }], error: null });
    await factoryService.getFactorySupplierRawMaterialEligibility("supplier-1", { linkedOnly: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_supplier_raw_material_eligibility", { p_supplier_id: "supplier-1", p_linked_only: false });

    mocks.rpc.mockResolvedValueOnce({ data: { supplier_id: "supplier-1", linked_material_ids: ["rm-1", "rm-2"] }, error: null });
    await factoryService.saveFactorySupplierRawMaterialLinks({ id: "supplier-1", supplier_name: "Fresh Farm", linked_material_ids: ["rm-1"] }, ["rm-1", "rm-2", "rm-2"]);
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_save_supplier_raw_material_links", { p_supplier_id: "supplier-1", p_raw_material_ids: ["rm-1", "rm-2"] });
  });
});
