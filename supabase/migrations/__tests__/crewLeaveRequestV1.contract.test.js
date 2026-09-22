import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030004_crew_leave_request_v1.sql"), "utf8").toLowerCase();
const submitFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030005_crew_leave_submit_runtime_fix.sql"), "utf8").toLowerCase();
const outletVisibility = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030006_crew_leave_admin_outlet_visibility.sql"), "utf8").toLowerCase();
const adminRosterFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030410_crew_leave_admin_roster_context_fix.sql"), "utf8").toLowerCase();
const mobileSessionFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813030820_crew_leave_mobile_session_runtime_fix.sql"), "utf8").toLowerCase();

describe("Crew Leave Request v1 migration", () => {
  it("separates requests, approved leave, roster projections and audit", () => {
    for (const table of ["crew_leave_requests", "crew_approved_leaves", "crew_leave_roster_projections", "crew_leave_audit"]) expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain("superseded_roster_entry jsonb");
    expect(sql).toContain("source text not null default 'approved_leave'");
  });

  it("keeps all exposed leave tables behind RLS and controlled RPCs", () => {
    for (const table of ["crew_leave_requests", "crew_approved_leaves", "crew_leave_roster_projections", "crew_leave_audit"]) expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain("revoke all on public.crew_leave_requests");
    for (const fn of ["crew_leave_submit", "crew_leave_mobile", "crew_leave_cancel", "crew_leave_admin_data", "crew_leave_review"]) {
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?security definer set search_path=public`));
    }
  });

  it("derives Crew identity from the opaque session and rejects client authority fields", () => {
    expect(sql).toContain("employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("p_payload ?| array['employee_id','status','reviewed_by','approved','requested_days']");
    expect(sql).not.toMatch(/crew_leave_submit\([^)]*employee_id/);
  });

  it("uses unambiguous v-prefixed variables in the applied submit authority", () => {
    expect(submitFix).toContain("v_start_date");
    expect(submitFix).toContain("v_end_date");
    expect(submitFix).toContain("daterange(v_start_date,v_end_date,'[]')");
    expect(submitFix).toContain("revoke all on function public.crew_leave_submit");
  });

  it("keeps Leave Admin outlet discovery permission- and scope-bound", () => {
    expect(outletVisibility).toContain("current_user_has_permission('crew_leave.view')");
    expect(outletVisibility).toContain("current_user_can_access_outlet(id)");
  });

  it("casts generated roster-context days to the date authority contract", () => {
    expect(adminRosterFix).toContain("crew_roster_employee_day(r.employee_id,d.d::date)");
    expect(adminRosterFix).toContain("security definer set search_path=public");
    expect(adminRosterFix).toContain("revoke all on function public.crew_leave_admin_data");
  });

  it("keeps the token-bound mobile authority volatile so session activity can refresh", () => {
    expect(mobileSessionFix).toContain("create or replace function public.crew_leave_mobile");
    expect(mobileSessionFix).not.toContain("stable security definer");
    expect(mobileSessionFix).toContain("security definer set search_path=public");
    expect(mobileSessionFix).toContain("grant execute on function public.crew_leave_mobile(text) to anon,authenticated");
  });

  it("enforces strict dates, duration and overlapping pending or approved requests", () => {
    expect(sql).toContain("end_date<start_date");
    expect(sql).toContain("duration='half_day'");
    expect(sql).toContain("status in ('pending','approved')");
    expect(sql).toContain("daterange(r.start_date,r.end_date,'[]') && daterange(start_date,end_date,'[]')");
  });

  it("allows only pending cancellation and requires a rejection reason", () => {
    expect(sql).toContain("only a pending leave request can be cancelled");
    expect(sql).toContain("a rejection reason is required");
  });

  it("projects approval without rewriting immutable publication history", () => {
    expect(sql).toContain("insert into public.crew_leave_roster_projections");
    expect(sql).toContain("source_publication_id");
    expect(sql).not.toMatch(/update public\.duty_roster_published_entries/);
    expect(sql).not.toMatch(/delete from public\.duty_roster_publications/);
  });

  it("blocks a normal working roster from overwriting approved employee-level leave", () => {
    expect(sql).toContain("crew_leave_block_roster_override");
    expect(sql).toContain("this employee has approved leave on the selected date");
    expect(sql).toContain("new.source,'manual_roster'");
  });

  it("returns leave projections through the same roster authority used by mobile and evidence", () => {
    expect(sql).toContain("create or replace function public.crew_roster_employee_day");
    expect(sql).toContain("create or replace function public.crew_my_roster");
    expect(sql).toContain("'source','approved_leave'");
    expect(sql).toContain("'approved_leave_days'");
    expect(sql).toContain("'roster-attendance-evidence-v2'");
  });
});
