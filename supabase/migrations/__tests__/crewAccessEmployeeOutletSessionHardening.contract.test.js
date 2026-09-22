import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260828125052_crew_access_employee_outlet_session_hardening.sql"), "utf8");
const backfill = readFileSync(resolve(process.cwd(), "supabase/migrations/20260828130508_crew_access_outlet_scope_backfill.sql"), "utf8");
const outletMetadataReconciliation = readFileSync(resolve(process.cwd(), "supabase/migrations/20260829034058_crew_access_outlet_metadata_reconciliation.sql"), "utf8");

describe("Crew Access Employee Master outlet and session authority", () => {
  it("synchronizes Crew Access scope from Employee Master workplace changes and revokes sessions", () => {
    expect(sql).toContain("crew_access_sync_employee_outlet_scope");
    expect(sql).toContain("after update of workplace on public.employees");
    expect(sql).toContain("v_current_outlet_id := public.crew_resolve_employee_outlet(new.id)");
    expect(sql).toContain("update public.crew_sessions");
    expect(sql).toContain("crew_access_outlet_scope_synced");
  });

  it("realigns pre-existing stale Crew Access scope through a separate audited forward-only backfill", () => {
    expect(backfill).toContain("crew_access_outlet_scope_backfilled");
    expect(backfill).toContain("ca.primary_outlet_id is distinct from public.crew_resolve_employee_outlet(ca.employee_id)");
    expect(backfill).toContain("update public.crew_sessions");
  });

  it("reconciles the Phase A mirror when outlet name or code changes the Employee Master resolver", () => {
    expect(outletMetadataReconciliation).toContain("after update of name, code on public.outlets");
    expect(outletMetadataReconciliation).toContain("crew_access_outlet_metadata_scope_reconciled");
    expect(outletMetadataReconciliation).toContain("v_current_outlet_id := public.crew_resolve_employee_outlet(v_access.employee_id)");
    expect(outletMetadataReconciliation).toContain("update public.crew_sessions");
  });

  it("fails closed when a session, employee, Crew Access record, or canonical outlet no longer matches", () => {
    expect(sql).toContain("s.revoked_at is null");
    expect(sql).toContain("s.expires_at > now()");
    expect(sql).toContain("ca.access_state = 'active'");
    expect(sql).toContain("coalesce(e.is_active, true)");
    expect(sql).toContain("ca.primary_outlet_id = public.crew_resolve_employee_outlet(e.id)");
  });

  it("keeps admin listing and Special Access server-scoped, audited, and role-independent", () => {
    expect(sql).toContain("create or replace function public.crew_access_admin_list");
    expect(sql).toContain("public.current_user_can_access_outlet(p_outlet_id)");
    expect(sql).toContain("where public.crew_resolve_employee_outlet(e.id) = p_outlet_id");
    expect(sql).toContain("crew_update_cash_operations_access");
    expect(sql).toContain("crew_access_cash_handover_capability_updated");
    expect(sql).not.toMatch(/crew_update_cash_operations_access[\s\S]*role_permissions/);
  });
});
