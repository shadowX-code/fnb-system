import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock("../auditLogService", () => ({ auditLogService: { createAuditLog: mocks.createAuditLog } }));

import { factoryService } from "../factoryService.js";

const sop = {
  id: "sop-1",
  sop_code: "SOP-001",
  title: "Sambal Production SOP · v2",
  finished_good_id: "family-1",
  version: "v2",
  status: "active",
  effective_date: "2026-08-09",
  finished_good: { name_en: "Sambal", name_cn: "叁巴酱" },
  linked_recipe: { id: "recipe-1", product_family_id: "family-1", version: "v2", status: "active", items: [] },
  steps: [],
};

function sopFetch(result = sop) {
  return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: result, error: null }) })) })) };
}

describe("Factory Production SOP and QC preset trusted lifecycle contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation(() => sopFetch());
  });

  it("saves the exact SOP structure payload with server-owned actor authority", async () => {
    mocks.rpc.mockResolvedValue({ data: { sop_id: sop.id }, error: null });
    await factoryService.saveProductionSop({
      id: sop.id,
      finished_good_id: "family-1",
      title: sop.title,
      effective_date: "2026-08-09",
      remarks: "Cook in sequence",
      recipe_id: "recipe-1",
      recipe_version: "v2",
      steps: [{
        id: "123e4567-e89b-42d3-a456-426614174000",
        step_name: "Cook",
        description: "Cook until ready",
        estimated_time_minutes: 10,
        ingredient_material_ids: ["rm-1", "rm-1"],
        qc_checks: [{ id: "123e4567-e89b-42d3-a456-426614174001", qc_type: "checklist", checklist_template_id: "qc-1", qc_name: "Temperature", instructions: "Check temperature", is_required: true }],
        remarks: "Stir continuously",
        sub_steps: [{ instruction: "Heat", estimated_minutes: 4, remarks: "Low heat" }, { instruction: "Stir", estimated_minutes: 6, remarks: "" }],
      }],
    });

    expect(mocks.rpc).toHaveBeenCalledWith("factory_save_production_sop_structure", {
      p_sop_id: sop.id,
      p_finished_good_id: "family-1",
      p_title: sop.title,
      p_effective_date: "2026-08-09",
      p_remarks: "Cook in sequence",
      p_recipe_id: "recipe-1",
      p_recipe_version: "v2",
      p_created_by: null,
      p_steps: [expect.objectContaining({
        step_no: 1,
        step_name: "Cook",
        estimated_time_minutes: 10,
        ingredient_material_ids: ["rm-1"],
        sub_steps: [expect.objectContaining({ sequence_no: 1, instruction: "Heat", estimated_minutes: 4 }), expect.objectContaining({ sequence_no: 2, instruction: "Stir", estimated_minutes: 6 })],
        qc_checks: [expect.objectContaining({ sequence_no: 1, qc_type: "checklist", checklist_template_id: "qc-1", qc_name: "Temperature", is_required: true })],
      })],
    });
  });

  it("routes activation, new version, archive, and restore through exact trusted SOP RPCs", async () => {
    mocks.rpc.mockResolvedValue({ data: { sop_id: sop.id }, error: null });
    await factoryService.activateProductionSop({ ...sop, status: "draft" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_activate_production_sop", { p_sop_id: sop.id });

    const draft = { ...sop, id: "sop-2", version: "v3", status: "draft" };
    mocks.rpc.mockResolvedValue({ data: { sop_id: draft.id }, error: null });
    mocks.from.mockImplementation(() => sopFetch(draft));
    await expect(factoryService.createProductionSopNewVersion(sop)).resolves.toEqual(expect.objectContaining({ id: draft.id, finished_good_id: sop.finished_good_id, version: "v3", status: "draft" }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_create_production_sop_new_version", { p_source_sop_id: sop.id });

    mocks.rpc.mockResolvedValue({ data: { sop_id: sop.id }, error: null });
    await factoryService.archiveProductionSop(sop);
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_archive_production_sop", { p_sop_id: sop.id });

    mocks.rpc.mockResolvedValue({ data: { sop_id: sop.id }, error: null });
    await factoryService.restoreProductionSop({ ...sop, status: "archived" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_restore_production_sop", { p_sop_id: sop.id });
    await expect(factoryService.archiveProductionSop({ ...sop, status: "draft" })).rejects.toThrow("Only active Production SOPs can be archived.");
  });

  it("keeps Draft delete separate from Active archive", async () => {
    const lookup = { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { ...sop, status: "draft" }, error: null }) })) })) };
    const deletion = { delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) })) };
    mocks.from.mockImplementationOnce(() => lookup).mockImplementationOnce(() => deletion);
    await factoryService.deleteProductionSop({ ...sop, status: "draft" });
    expect(deletion.delete).toHaveBeenCalled();

    mocks.from.mockImplementationOnce(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: sop, error: null }) })) })) }));
    await expect(factoryService.deleteProductionSop(sop)).rejects.toThrow("Only draft Production SOPs can be deleted.");
  });

  it("uses named trusted QC preset lifecycle RPCs and never sends a client actor id", async () => {
    const template = { id: "qc-1", name: "Temperature", result_mode: "checklist", description: "Check", is_active: true };
    const templateFetch = { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: template, error: null }) })) })) };
    mocks.rpc.mockResolvedValue({ data: { template_id: template.id }, error: null });
    mocks.from.mockImplementation(() => templateFetch);
    await factoryService.createQcChecklistTemplate(template, "client-employee-id");
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_create_qc_checklist_template", { p_name: "Temperature", p_result_mode: "checklist", p_description: "Check", p_created_by: null });

    mocks.rpc.mockResolvedValue({ data: { template_id: template.id }, error: null });
    await factoryService.updateQcChecklistTemplate(template);
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_update_qc_checklist_template", { p_template_id: template.id, p_name: "Temperature", p_result_mode: "checklist", p_description: "Check" });

    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await factoryService.archiveQcChecklistTemplate(template);
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_archive_qc_checklist_template", { p_template_id: template.id });
    await factoryService.restoreQcChecklistTemplate(template);
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_restore_qc_checklist_template", { p_template_id: template.id });
    await factoryService.deleteQcChecklistTemplate(template);
    expect(mocks.rpc).toHaveBeenLastCalledWith("factory_delete_qc_checklist_template", { p_template_id: template.id });
  });
});
