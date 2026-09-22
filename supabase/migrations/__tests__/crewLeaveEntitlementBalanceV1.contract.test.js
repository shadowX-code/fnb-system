import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813132950_crew_leave_entitlement_balance_v1.sql"), "utf8").toLowerCase();
const lifecycle = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813135311_crew_leave_entitlement_lifecycle_guard.sql"), "utf8").toLowerCase();

describe("Crew Leave Entitlement / Balance v1 migration", () => {
  it("models policy, annual grants and immutable adjustments separately", () => {
    for (const table of ["crew_leave_policies", "crew_leave_entitlements", "crew_leave_adjustments"]) expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain("unique(employee_id,leave_type,period_start)");
    expect(sql).not.toMatch(/update public\.crew_leave_adjustments/);
    expect(sql).not.toMatch(/delete from public\.crew_leave_adjustments/);
  });

  it("keeps used, pending and available server-derived from leave evidence", () => {
    expect(sql).toContain("create or replace function public.crew_leave_entitlement_balance");
    expect(sql).toContain("from public.crew_approved_leaves");
    expect(sql).toContain("from public.crew_leave_requests");
    expect(sql).toContain("r.status='pending'");
    expect(sql).toContain("entitled-used_days-pending_days");
  });

  it("uses calendar days, half days and join-date proration with a version", () => {
    expect(sql).toContain("calendar-days-half-day-v1");
    expect(sql).toContain("when p_duration='half_day' then 0.5");
    expect(sql).toContain("eligible_calendar_days");
    expect(sql).toContain("weekends_and_public_holidays_excluded',false");
    expect(sql).toContain("round((policy.annual_days*eligible_days/total_days)*2)/2");
  });

  it("reserves pending requests and re-checks before approval", () => {
    expect(sql).toContain("insufficient leave balance for this request");
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtext('crew_leave:'");
    expect(sql).toContain("insufficient leave balance. reject or adjust the entitlement before approval");
  });

  it("uses fixed-path controlled authorities and no direct table access", () => {
    for (const table of ["crew_leave_policies", "crew_leave_entitlements", "crew_leave_adjustments"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("revoke all on public.crew_leave_policies,public.crew_leave_entitlements,public.crew_leave_adjustments from public,anon,authenticated");
    for (const fn of ["crew_leave_entitlement_balance", "crew_leave_ensure_entitlement", "crew_leave_submit", "crew_leave_mobile", "crew_leave_admin_data", "crew_leave_policy_save", "crew_leave_adjust", "crew_leave_review"]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}[\\s\\s]*?security definer set search_path=public`.replace("[\\s\\s]", "[\\s\\S]")));
      expect(sql).toContain(`revoke all on function public.${fn}`);
    }
  });

  it("grants internal helpers to nobody and only exposes intended RPC roles", () => {
    expect(sql).not.toMatch(/grant execute on function public\.crew_leave_entitlement_balance/);
    expect(sql).not.toMatch(/grant execute on function public\.crew_leave_ensure_entitlement/);
    expect(sql).toContain("grant execute on function public.crew_leave_mobile(text) to anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_leave_policy_save(uuid,text,jsonb) to authenticated");
    expect(sql).toContain("grant execute on function public.crew_leave_adjust(uuid,numeric,text) to authenticated");
  });

  it("preserves existing request and roster evidence instead of rewriting history", () => {
    expect(sql).not.toMatch(/delete from public\.crew_leave_requests/);
    expect(sql).not.toMatch(/update public\.crew_approved_leaves/);
    expect(sql).not.toMatch(/update public\.duty_roster_published_entries/);
    expect(sql).toContain("their evidence is counted dynamically");
  });

  it("retains historical grants but blocks future generation for departed Crew", () => {
    expect(lifecycle).toContain("if result_id is not null then return result_id");
    expect(lifecycle).toContain("employment_status,'') in ('resigned','terminated')");
    expect(lifecycle).toContain("future leave entitlement cannot be generated for a departed employee");
    expect(lifecycle).toContain("security definer set search_path=public");
    expect(lifecycle).toContain("revoke all on function public.crew_leave_ensure_entitlement");
  });
});
