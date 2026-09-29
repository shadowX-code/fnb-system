import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase.ts", () => ({ supabase: { rpc } }));
import { employeeEmploymentService } from "../employeeEmploymentService.js";

const authority = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929024532_people_employment_assignment_timeline.sql"), "utf8");
const validation = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929025028_people_employment_assignment_validation.sql"), "utf8");
const grants = readFileSync(resolve(process.cwd(), "supabase/migrations/20260929025447_people_employment_assignment_function_grants.sql"), "utf8");

beforeEach(() => rpc.mockReset());

describe("People Employment Assignment Timeline", () => {
  it("passes a date and complete state to the canonical People authority", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "resolved" }, error: null })
      .mockResolvedValueOnce({ data: { projection_state: "scheduled" }, error: null });
    expect(await employeeEmploymentService.read("employee", "2026-10-01")).toEqual({ state: "resolved" });
    expect(rpc).toHaveBeenCalledWith("employee_employment_assignment_read", { p_employee_id: "employee", p_on: "2026-10-01" });
    await employeeEmploymentService.save({ employeeId: "employee", effectiveFrom: "2026-10-01",
      assignment: { employment_type: "full_time", employment_status: "active", position: "Crew", legal_entity_id: null, workplace: "Outlet" },
      reason: "Confirmed transfer", expectedRevisionId: "prior", evidenceReference: "Letter" });
    expect(rpc).toHaveBeenCalledWith("employee_employment_assignment_save", expect.objectContaining({
      p_employee_id: "employee", p_effective_from: "2026-10-01", p_expected_revision_id: "prior",
      p_reason: "Confirmed transfer", p_evidence_reference: "Letter",
    }));
  });

  it("preserves unresolved pre-cutover dates and never infers an earlier assignment", () => {
    expect(authority).toContain("'cutover_current','Current Employee assignment at cutover; earlier history is unverified.'");
    expect(authority).toContain("'state',case when v_row.id is null then 'unresolved'");
    expect(authority).toContain("if v_cutover is null or p_effective_from<v_cutover then");
  });

  it("pins all five fields, guards direct writes, and keeps corrections append-only", () => {
    for (const field of ["employment_type", "employment_status", "position", "legal_entity_id", "workplace"]) {
      expect(authority).toContain(field);
    }
    expect(authority).toContain("employee_employment_projection_guard");
    expect(authority).toContain("employee_employment_assignment_immutable");
    expect(authority).toContain("supersedes_revision_id");
    expect(authority).toContain("p_expected_revision_id");
    expect(validation).toContain("employee_employment_one_baseline_idx");
    expect(grants).toContain("revoke all on function public.employee_employment_new_employee_baseline()");
  });

  it("activates due workplace changes through the existing Employee trigger, never on schedule creation", () => {
    expect(authority).toContain("if p_effective_from<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date then");
    expect(authority).toContain("create function public.employee_employment_activate_due()");
    expect(authority).toContain("update public.employees set employment_type=v_revision.employment_type");
    expect(authority).toContain("workplace=v_revision.workplace");
    expect(authority).toContain("'feedx_people_employment_activate_due','* * * * *'");
  });
});
