import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922192301_crew_management_operational_scope.sql"), "utf8");

describe("Management Crew operational scope", () => {
  it("reuses the active role outlet authority without changing fixed workplace identity", () => {
    expect(sql).toContain("v_role.outlet_access_type='all'");
    expect(sql).toContain("v_role.outlet_access_type='none'");
    expect(sql).toContain("public.role_outlets ro");
    expect(sql).toContain("ca.primary_outlet_id is null");
    expect(sql).toContain("ca.primary_outlet_id=public.crew_resolve_employee_outlet(e.id)");
    expect(sql).toContain("p_outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id))");
    expect(sql).toContain("v_employment_status text");
    expect(sql).toContain("coalesce(employment_status,'active')=v_employment_status");
  });

  it("keeps Management reads separate from action authorities", () => {
    for (const name of ["crew_management_tasks", "crew_management_asset_mobile", "crew_management_sop_library"]) {
      expect(sql).toContain(`create function public.${name}`);
      expect(sql).toMatch(new RegExp(`create function public\\.${name}[\\s\\S]*?perform public\\.crew_selected_outlet\\(p_token,p_outlet_id\\)`));
    }
    expect(sql).toContain("'read_only',true");
    expect(sql).toContain("'reference_only',true");
    expect(sql).toContain("v_access.primary_outlet_id is null");
    expect(sql).toContain("or lower(btrim(coalesce(v_employee.workplace,'')))='management'");
    expect(sql).not.toContain("crew_materialize_operation_instances");
  });

  it("resolves notification destinations from live records instead of outlet snapshots", () => {
    expect(sql).toContain("crew_notification_destination_outlet");
    expect(sql).toContain("recipient_employee_id=v_employee_id");
    expect(sql).toContain("i.id=v_notification.source_entity_id");
    expect(sql).toContain("v_outlet_id=any(public.crew_authorized_outlet_ids(v_employee_id))");
    expect(sql).not.toContain("v_notification.outlet_id_snapshot");
  });
});
