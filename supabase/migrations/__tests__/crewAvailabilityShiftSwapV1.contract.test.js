import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260813061304_crew_availability_shift_swap_v1.sql"), "utf8").toLowerCase();

describe("Crew Availability and Shift Swap v1 migration", () => {
  it("separates recurring availability, exceptions, requests and immutable audit", () => {
    for (const table of ["crew_availability_windows", "crew_availability_exceptions", "crew_shift_requests", "crew_shift_request_audit"]) expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain("availability_type text not null check");
    expect(sql).toContain("coverage_mode text not null check");
    expect(sql).toContain("status text not null check");
  });

  it("keeps data behind controlled token- or permission-bound authorities", () => {
    for (const table of ["crew_availability_windows", "crew_availability_exceptions", "crew_shift_requests", "crew_shift_request_audit"]) expect(sql).toContain(`alter table public.${table} enable row level security`);
    for (const fn of ["crew_availability_save", "crew_availability_mobile", "crew_shift_candidates", "crew_shift_request_submit", "crew_shift_request_respond", "crew_shift_request_cancel", "crew_shift_requests_mobile", "crew_shift_requests_admin", "crew_shift_request_review"]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}[\\s\\s]*?security definer set search_path=public`.replace("[\\s\\s]", "[\\s\\S]")));
    }
    expect(sql).toContain("employee:=public.crew_session_employee(p_token)");
    expect(sql).toContain("current_user_can_access_outlet");
    expect(sql).toContain("current_user_has_permission('crew_shift_requests.review')");
  });

  it("keeps internal eligibility helpers private and mobile grants explicit", () => {
    expect(sql).toContain("revoke all on function public.crew_employee_availability(uuid,date,time,time) from public,anon,authenticated");
    expect(sql).toContain("revoke all on function public.crew_shift_candidate_eligible(uuid,uuid) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_availability_save(text,jsonb)");
    expect(sql).toContain("to anon,authenticated");
  });

  it("models availability as planning evidence and approved leave as a hard block", () => {
    expect(sql).toContain("crew_roster_availability_check");
    expect(sql).toContain("'hard_block',approved_leave");
    expect(sql).toContain("availability_conflict boolean not null default false");
    expect(sql).toContain("crew_roster_capture_availability_conflict");
  });

  it("validates the latest published working shift and replacement eligibility", () => {
    expect(sql).toContain("only your future published working shift can be swapped");
    expect(sql).toContain("p.revision=(select max");
    expect(sql).toContain("leave_conflict");
    expect(sql).toContain("roster_conflict");
    expect(sql).toContain("same_position");
  });

  it("publishes a new immutable roster revision instead of updating history", () => {
    expect(sql).toContain("coalesce(max(revision),0)+1");
    expect(sql).toContain("insert into public.duty_roster_publications");
    expect(sql).toContain("insert into public.duty_roster_published_entries");
    expect(sql).not.toMatch(/update public\.duty_roster_published_entries/);
    expect(sql).not.toMatch(/delete from public\.duty_roster_publications/);
  });

  it("records every request transition and prevents caller-controlled identity", () => {
    expect(sql).toContain("insert into public.crew_shift_request_audit");
    expect(sql).toContain("p_payload ?| array['requester_employee_id','status','approved','reviewed_by']");
    expect(sql).not.toMatch(/crew_shift_request_submit\([^)]*employee_id/);
  });
});
