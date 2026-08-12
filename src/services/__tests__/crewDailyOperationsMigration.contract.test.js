import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve("supabase/migrations/20260812171446_crew_daily_operations_v1.sql"), "utf8");
const businessDateFix = readFileSync(resolve("supabase/migrations/20260812181500_crew_daily_operations_business_date_default_fix.sql"), "utf8");

describe("Crew Daily Operations migration contract", () => {
  it("creates versioned templates, frozen instances and direct-table denial", () => {
    for (const table of ["crew_operation_templates", "crew_operation_template_items", "crew_operation_instances", "crew_operation_instance_items", "crew_daily_tasks"]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("template_snapshot jsonb not null");
    expect(sql).toContain("revoke all on public.crew_operation_templates");
  });

  it("keeps Crew identity token-bound and every authority explicitly granted", () => {
    expect(sql).toContain("public.crew_session_employee(p_token)");
    expect(sql).toContain("security definer set search_path=public");
    expect(sql).toContain("grant execute on function public.crew_operations_today(text,date) to anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_operations_admin_data(uuid,date) to authenticated");
    expect(sql).not.toMatch(/grant execute on function public\.crew_operations_employee_context[^;]+to (anon|authenticated)/);
  });

  it("freezes published SOP references and rejects unavailable photo evidence", () => {
    expect(sql).toContain("v.status='published'");
    expect(sql).toContain("'sop_version_id',v_sop_version_id");
    expect(sql).toContain("Photo evidence is not available until a dedicated Operations evidence store is enabled.");
    expect(sql).not.toContain("performance_score");
  });

  it("uses the Malaysia business date when an RPC caller omits the date", () => {
    expect(businessDateFix).toContain("timezone('Asia/Kuala_Lumpur',now())::date");
    expect(businessDateFix).not.toContain("default public.crew_operations_business_date()");
    expect(businessDateFix).toContain("default timezone('Asia/Kuala_Lumpur',now())::date");
  });
});
