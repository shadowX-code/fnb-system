import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260903290000_factory_mesti_operator_hygiene_inspection.sql"), "utf8");

describe("Factory MeSTI Operator Hygiene contract", () => {
  it("uses a daily session with immutable submitted and verified evidence", () => {
    expect(sql).toContain("factory_mesti_operator_hygiene_sessions");
    expect(sql).toContain("inspection_date date not null unique");
    expect(sql).toContain("status text not null default 'draft' check (status in ('draft', 'submitted', 'verified'))");
    expect(sql).toContain("submitted_by uuid references public.employees(id)");
    expect(sql).toContain("verified_by uuid references public.employees(id)");
    expect(sql).toContain("Submitted hygiene sessions are immutable.");
  });

  it("uses canonical employees and derives the overall inspection result server-side", () => {
    expect(sql).toContain("employee_id uuid not null references public.employees(id)");
    expect(sql).toContain("employee_snapshot jsonb not null");
    expect(sql).toContain("case when v_clothing = 'pass' and v_hygiene = 'pass' then 'compliant' else 'non_compliant' end");
    expect(sql).toContain("Fail entries require an Issue and Action.");
  });

  it("enforces trusted RPC permissions, RLS read contracts, and self-verification blocking", () => {
    expect(sql).toContain("current_user_has_permission('factory_mesti_operator_hygiene.manage')");
    expect(sql).toContain("current_user_has_permission('factory_mesti_operator_hygiene.submit')");
    expect(sql).toContain("current_user_has_permission('factory_mesti_operator_hygiene.verify')");
    expect(sql).toContain("if v_session.submitted_by = v_actor then");
    expect(sql).toContain("Self-verification is not allowed.");
    expect(sql).toContain("revoke all on function public.factory_mesti_save_operator_hygiene(jsonb) from public, anon");
    expect(sql).toContain("grant execute on function public.factory_mesti_operator_hygiene_monthly(date) to authenticated");
  });
});
