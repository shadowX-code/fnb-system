import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260923100000_crew_access_workplace_listing.sql"), "utf8");

describe("Crew Access Employee Workplace listing", () => {
  it("keeps the canonical paged contract and authenticated grant", () => {
    expect(sql).toContain("create or replace function public.crew_access_admin_page(");
    expect(sql).toContain("returns jsonb language plpgsql stable security definer set search_path=public");
    expect(sql).toContain("'rows',v_rows,'total_count',v_total,'page',v_page");
    expect(sql).toContain("grant execute on function public.crew_access_admin_page(uuid,jsonb,integer,integer) to authenticated");
  });

  it("separates Management from outlet workplaces without role-driven outlet duplication", () => {
    expect(sql).toContain("v_scope='management' and lower(btrim(coalesce(e.workplace,'')))='management'");
    expect(sql).toContain("v_scope='' and lower(btrim(coalesce(e.workplace,'')))<>'management'");
    expect(sql).toContain("public.crew_resolve_employee_outlet(e.id)=p_outlet_id");
    expect(sql).toContain("public.current_user_has_all_outlet_access()");
    expect(sql).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(sql).not.toContain("p_outlet_id=any(public.crew_authorized_outlet_ids(e.id))");
    expect(sql).toContain("'role_outlet_access',jsonb_build_object");
    expect(sql).toContain("where ro.role_id=r.id and o.is_active");
  });
});
