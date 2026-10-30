import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: db }));
import { factoryService } from "../factoryService.js";
import { productionSopStructure } from "../../features/factory/utils/productionSop.js";
import { sopTotalEstimatedMinutes } from "../../features/factory/utils/factoryFormatters.js";

let reads, tables, snapshots;
beforeEach(() => {
  vi.clearAllMocks(); reads = [];
  tables = {
    factory_production_sops: [{ id: "sop-1", version: "v1", status: "draft", finished_good_id: "family", equipment_links: [], title: "SOP" }, { id: "sop-2", version: "v2", status: "active" }],
    factory_production_sop_steps: [{ id: "step-1", sop_id: "sop-1", step_no: 1, process_name: "Cook", estimated_time_minutes: 90, is_qc_checkpoint: true }, { id: "step-2", sop_id: "sop-1", step_no: 2, process_name: "Pack", estimated_time_minutes: 5 }],
    factory_production_sop_sub_steps: [{ id: "sub-1", sop_step_id: "step-1", sequence_no: 1, instruction: "Stir", estimated_minutes: 10 }],
    factory_production_sop_step_qc_checks: [{ id: "qc-1", sop_step_id: "step-1", qc_name: "Temperature", sequence_no: 1 }],
    factory_raw_materials: [{ id: "material", name: "Ingredient", uom: "kg" }],
  };
  snapshots = {
    sop_steps: tables.factory_production_sop_steps.map(r => ({ id: r.id, parent_id: r.sop_id })),
    sop_sub_steps: [{ id: "sub-1", parent_id: "step-1" }],
    sop_qc_checks: [{ id: "qc-1", parent_id: "step-1" }],
    sop_step_materials: [{ sop_step_id: "step-1", raw_material_id: "material" }],
  };
  db.rpc.mockImplementation(async (name, args) => ({ data: name === "factory_get_master_id_snapshot"
    ? args.p_entity === "production_sops" ? ["sop-1", "sop-2"] : []
    : (snapshots[args.p_entity] || []).filter(r => args.p_parent_ids.includes(r.parent_id || r.sop_step_id)), error: null }));
  db.from.mockImplementation(table => {
    let ids, fields;
    const query = { select(value) { fields = value; return this; }, in(_, value) { ids = value; return this; }, order() { return this; }, abortSignal() { return this; }, then(resolve, reject) {
      reads.push({ table, ids, fields });
      return Promise.resolve({ data: (tables[table] || []).filter(row => !ids || ids.includes(row.id)), error: null }).then(resolve, reject);
    } };
    return query;
  });
});

describe("SOP summary/detail complete read boundary", () => {
  it("reconciles every list row/count/duration while excluding instructions, materials and Recipe trees", async () => {
    const list = await factoryService.listFactoryData({ scope: "production-sop", hasPermission: () => true });
    const detail = await factoryService.listFactoryData({ scope: "production-sop", action: "sop-details", sopId: "sop-1", hasPermission: () => true });
    expect(list.accessIssues).toEqual([]);
    expect(list.sops).toHaveLength(2);
    expect(list.sopDetailsDeferred).toBe(true);
    const summary = list.sops[0]; const full = detail.sops[0];
    expect(summary).toMatchObject({ detail_complete: false, steps: [], list_summary: { stepCount: 2, subStepCount: 1, qcCount: 1, estimatedMinutes: 15 } });
    expect(productionSopStructure(summary)).toMatchObject(productionSopStructure(full));
    expect(sopTotalEstimatedMinutes(summary)).toBe(sopTotalEstimatedMinutes(full));
    expect(detail.sops).toHaveLength(1);
    expect(full.detail_complete).toBe(true);
    expect(full.steps[0]).toMatchObject({ process_name: "Cook", ingredient_material_ids: ["material"], sub_steps: [expect.objectContaining({ instruction: "Stir" })] });
    expect(reads.find(r => r.table === "factory_production_sop_steps").fields).not.toMatch(/instruction|description/);
    expect(reads.filter(r => r.table === "factory_production_sops").at(-1).ids).toEqual(["sop-1"]);
  });

  it("fails closed on missing/duplicate snapshot details, without returning a partial list", async () => {
    tables.factory_production_sop_steps = tables.factory_production_sop_steps.slice(1);
    const result = await factoryService.listFactoryData({ scope: "production-sop", hasPermission: () => true });
    expect(result.sops).toEqual([]);
    expect(result.accessIssues).toContainEqual(expect.objectContaining({ key: "sops", kind: "load", complete: true }));
  });

  it("does not save a list summary or bypass complete action readiness", async () => {
    await expect(factoryService.saveProductionSop({ id: "sop-1", detail_complete: false, steps: [] })).rejects.toThrow("Load complete SOP");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("keeps all >300 step identities in deterministic order across concurrent pages", async () => {
    tables.factory_production_sop_steps = Array.from({ length: 650 }, (_, i) => ({ id: `step-${i}`, sop_id: "sop-1", step_no: i + 1, estimated_time_minutes: 1 }));
    snapshots.sop_steps = tables.factory_production_sop_steps.map(r => ({ id: r.id, parent_id: r.sop_id }));
    snapshots.sop_sub_steps = []; snapshots.sop_qc_checks = [];
    const result = await factoryService.listFactoryData({ scope: "production-sop", hasPermission: () => true });
    expect(result.accessIssues).toEqual([]);
    expect(result.sops[0].list_summary).toMatchObject({ stepCount: 650, estimatedMinutes: 650 });
    expect(reads.filter(r => r.table === "factory_production_sop_steps").map(r => r.ids.length)).toEqual([300,300,50]);
  });
});
