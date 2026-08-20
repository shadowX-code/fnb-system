import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260820180619_crew_cash_checkout_mobile_position_authority.sql"), "utf8").toLowerCase();

describe("Crew Cash Checkout mobile authority correction", () => {
  it("allows active token-bound Crew to reach the existing position gate without granting table access", () => {
    expect(sql).toContain("p_permission='crew_cash_checkout.perform'");
    expect(sql).toContain("join public.crew_access ca on ca.employee_id=e.id");
    expect(sql).toContain("ca.access_state='active'");
    expect(sql).toContain("ca.primary_outlet_id is not null");
  });

  it("keeps the helper non-callable by client roles", () => {
    expect(sql).toContain("revoke all on function public.crew_cash_employee_has_permission(uuid,text) from public,anon,authenticated");
    expect(sql).toContain("set search_path=public");
  });
});
