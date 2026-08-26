import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826130618_crew_access_cash_handover_capability.sql"), "utf8").toLowerCase();

describe("Crew Access Cash Handover capability", () => {
  it("makes initiation a Crew Access capability, not an Admin RBAC inference", () => {
    expect(sql).toContain("add column if not exists can_initiate_handover boolean not null default false");
    expect(sql).toContain("create or replace function public.crew_can_initiate_cash_handover");
    expect(sql).toContain("ca.can_initiate_handover");
    expect(sql).toContain("ca.access_state = 'active'");
    expect(sql).toContain("ca.primary_outlet_id = p_outlet_id");
    expect(sql).not.toMatch(/crew_can_initiate_cash_handover[\s\S]*role_permissions/);
  });

  it("takes a one-time compatibility snapshot only for previously effective active Crew users", () => {
    expect(sql).toContain("preserve only the already-effective crew handover population at cutover");
    expect(sql).toContain("ca.access_state = 'active'");
    expect(sql).toContain("ca.primary_outlet_id is not null");
    expect(sql).toContain("p.code = 'crew_cash_deposit.record_collection'");
    expect(sql).toContain("future admin role edits have no effect");
  });

  it("keeps server-side handover authorization token, outlet and Crew-capability bound", () => {
    expect(sql).toContain("ctx:=public.crew_operations_employee_context(p_token)");
    expect(sql).toContain("if not public.crew_can_initiate_cash_handover(employee,outlet)");
    expect(sql).toContain("receiver is null or not public.crew_cash_receiver_is_eligible(outlet,receiver)");
    expect(sql).toContain("amount>public.crew_cash_balance(outlet)");
    expect(sql).toContain("request_id is required");
    expect(sql).not.toMatch(/crew_cash_record_collection[\s\S]*crew_cash_employee_has_permission/);
  });

  it("projects the canonical capability separately from receiver eligibility and retains the client alias", () => {
    expect(sql).toContain("'{can_initiate_handover}'");
    expect(sql).toContain("'{can_record_collection}'");
    expect(sql).toContain("'{is_cash_handover_receiver}'");
    expect(sql).toContain("crew_cash_receiver_is_eligible(outlet,employee)");
  });

  it("uses the existing Crew Access administration authority with outlet scope and audit evidence", () => {
    expect(sql).toContain("crew_update_cash_operations_access");
    expect(sql).toContain("current_user_has_permission('crew_employees.manage')");
    expect(sql).toContain("current_user_can_access_outlet(v_access.primary_outlet_id)");
    expect(sql).toContain("crew_access_cash_handover_capability_updated");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("grant execute on function public.crew_update_cash_operations_access(uuid,boolean) to authenticated");
  });
});
