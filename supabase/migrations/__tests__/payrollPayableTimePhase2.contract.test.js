import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925100000_payroll_payable_time_phase2.sql"), "utf8");
const sourceGuard = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925100003_payroll_time_removed_source_guard.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/payrollService.js"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollPage.jsx"), "utf8");
const workspace = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollTimeExceptionsTab.jsx"), "utf8");

describe("Payroll Phase 2 payable-time authority", () => {
  it("owns append-only decisions and final-run snapshots without editing source evidence", () => {
    expect(migration).toContain("create table public.payroll_payable_time_versions");
    expect(migration).toContain("create table public.payroll_run_time_snapshots");
    expect(migration).toContain("payroll_payable_time_versions','payroll_run_time_snapshots");
    expect(migration).toContain("revoke all on public.payroll_payable_time_versions,public.payroll_run_time_snapshots");
    expect(migration).toContain("Finalized period requires an open correction run");
    expect(migration).not.toMatch(/update public\.(crew_attendance_records|duty_roster_published_entries|crew_approved_leaves)/);
  });

  it("uses published roster, original attendance, leave, holiday and effective profile context", () => {
    for (const source of ["duty_roster_published_entries", "crew_attendance_records", "crew_approved_leaves", "payroll_public_holidays", "payroll_compensation_versions"])
      expect(migration).toContain(source);
    expect(migration).toContain("scheduled_roster_entry_id");
    expect(migration).toContain("v_roster.break_minutes");
    expect(migration).toContain("v_proposed := greatest(0");
    expect(migration).toContain("source_fingerprint");
    expect(sourceGuard).toContain("source_removed");
    expect(sourceGuard).toContain("payroll_time_evidence_base");
  });

  it("only auto-approves normal evidence and gates hourly readiness", () => {
    for (const issue of ["late_arrival", "early_departure", "extra_time", "missing_punch", "unscheduled_work", "outlet_mismatch", "leave_conflict", "public_holiday_review"])
      expect(migration).toContain(issue);
    expect(migration).toContain("v_status='approved_auto'");
    expect(migration).toContain("c.pay_basis='hourly'");
    expect(migration).toContain("Hourly payable time is not ready");
    expect(migration).toContain("payroll_time_snapshot_finalized_run");
  });

  it("exposes only Payroll commands and an exception-only review workspace", () => {
    for (const rpc of ["payroll_time_read", "payroll_time_reconcile", "payroll_time_decide", "payroll_run_time_readiness"])
      expect(service).toContain(rpc);
    expect(service).not.toContain('.from("crew_attendance_records")');
    expect(page).toContain('"Review Time"');
    expect(workspace).toContain("Reconcile Evidence");
    expect(workspace).toContain("Record Decision");
    expect(workspace).toContain("Original Roster, Attendance and Leave evidence is never edited.");
  });
});
