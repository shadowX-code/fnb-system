import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260914120606_factory_sop_draft_equipment_activation_guard.sql"), "utf8");
const internalGrantSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260914121605_factory_sop_draft_equipment_internal_rpc_grants.sql"),
  "utf8",
);

describe("Factory Production SOP Draft Equipment lifecycle", () => {
  it("allows Draft creation and Draft saves without Equipment validation", () => {
    expect(sql).toContain("rename to factory_save_production_sop_structure_impl_20260914");
    expect(sql).toContain("v_saved := public.factory_save_production_sop_structure(");
    expect(sql).toContain("delete from public.factory_production_sop_equipment where sop_id = v_sop_id;");
    expect(sql).toContain("from unnest(coalesce(p_equipment_ids, '{}'::uuid[])) equipment_id");
    expect(sql).not.toContain("Bind at least one active Equipment item to a Production SOP.");
    expect(sql).not.toContain("cardinality(coalesce(p_equipment_ids");
  });

  it("blocks activation without a valid active Equipment binding", () => {
    expect(sql).toContain("rename to factory_activate_production_sop_impl_20260914");
    expect(sql).toContain("from public.factory_production_sop_equipment binding");
    expect(sql).toContain("equipment.status = 'active'");
    expect(sql).toContain("Assign at least one active Equipment before activating this SOP.");
  });

  it("preserves the existing trusted activation and Draft-save authorities", () => {
    expect(sql).toContain("perform public.factory_current_active_employee_id();");
    expect(sql).toContain("return public.factory_activate_production_sop_impl_20260914(p_sop_id);");
    expect(sql).toContain("and lower(coalesce(sop.status, '')) = 'draft'");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("grant execute on function public.factory_save_production_sop_structure");
    expect(sql).toContain("grant execute on function public.factory_activate_production_sop(uuid) to authenticated;");
  });

  it("keeps renamed lifecycle implementations inaccessible to API roles", () => {
    expect(internalGrantSql).toContain(
      "revoke all on function public.factory_save_production_sop_structure_impl_20260914(",
    );
    expect(internalGrantSql).toContain("from public, anon, authenticated;");
    expect(internalGrantSql).toContain(
      "revoke all on function public.factory_activate_production_sop_impl_20260914(uuid)",
    );
  });
});
