import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260923152133_crew_management_special_access_outlets.sql"), "utf8");

describe("Management Crew Special Access outlet authority", () => {
  it("keeps Management grants separate from legacy fixed-outlet flags and private to trusted functions", () => {
    expect(sql).toContain("primary key (employee_id, outlet_id)");
    expect(sql).toContain("alter table public.crew_management_special_access enable row level security");
    expect(sql).toContain("revoke all on public.crew_management_special_access from public, anon, authenticated");
    expect(sql).toContain("p_outlet_id=any(public.crew_authorized_outlet_ids(p_employee_id))");
    expect(sql).toContain("not public.current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("lower(btrim(coalesce(v_employee.workplace,'')))='management'");
    expect(sql).toContain("v_grant:=public.crew_special_access_for_outlet(v_employee_id,v_outlet_id)");
  });

  it("binds Management actions to explicit outlet checks without exposing checkout", () => {
    expect(sql).toContain("perform public.crew_selected_outlet(p_token,p_outlet_id)");
    expect(sql).toContain("perform set_config('feedx.crew_management_outlet',p_outlet_id::text,true)");
    expect(sql).toContain("perform set_config('feedx.crew_management_handover_outlet',p_outlet_id::text,true)");
    expect(sql).toContain("return public.crew_cash_record_collection(p_token,p_payload)");
    expect(sql).toContain("'can_perform',false");
    expect(sql).toContain("'checkout',null");
  });
});
