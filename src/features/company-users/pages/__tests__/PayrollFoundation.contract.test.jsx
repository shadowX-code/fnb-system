import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { moduleRegistry } from "../../../../../config/modules.ts";
import { routeDetails } from "../../../../app/routes.jsx";
import { getAdminRouteDefinition, resolveCanonicalPath } from "../../../../app/routeOwnership.js";
import PayrollPage from "../PayrollPage.jsx";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925083003_payroll_foundation.sql"), "utf8");
const approverProjection = readFileSync(resolve(process.cwd(), "supabase/migrations/20260925160342_payroll_run_approver_projection.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/payrollService.js"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/PayrollPage.jsx"), "utf8");

describe("People Payroll Phase 1 foundation", () => {
  it("has one People route and dedicated payroll permissions", () => {
    expect(moduleRegistry.find((module) => module.id === "payroll")).toMatchObject({
      section: "People", route: "/people/payroll",
      permissions: { view: true, manage: true, finalize: true },
    });
    expect(routeDetails.payroll).toMatchObject({ component: PayrollPage, permission: "payroll.view" });
    expect(getAdminRouteDefinition("payroll")?.canonicalPath).toBe("/people/payroll");
    expect(resolveCanonicalPath("/people/payroll")?.routeId).toBe("payroll");
  });

  it("keeps salary and recurring/statutory history append-only and prevents direct client table access", () => {
    for (const table of [
      "payroll_profiles", "payroll_compensation_versions", "payroll_component_definitions",
      "payroll_recurring_component_versions", "payroll_statutory_profile_versions",
      "payroll_public_holidays", "payroll_periods", "payroll_runs",
      "payroll_run_profile_snapshots", "payroll_events",
    ]) expect(migration).toContain(`'${table}'`);
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.%I from public,anon,authenticated");
    expect(migration).toContain("Payroll historical evidence is immutable.");
    expect(migration).toContain("Finalized payroll runs are immutable.");
    expect(migration).toContain("unique(profile_id,effective_from)");
    expect(migration).toContain("unique(profile_id,component_id,effective_from)");
  });

  it("retains contract provenance without synchronization and keeps pay basis distinct", () => {
    expect(migration).toContain("source_document_id uuid references public.employee_employment_documents");
    expect(migration).toContain("pay_basis text not null check(pay_basis in ('monthly','hourly'))");
    expect(migration).toContain("socso_applicable boolean");
    expect(migration).not.toContain("update public.employee_employment_documents");
    expect(migration).not.toContain("update public.employees");
    expect(service).not.toContain('.from("employees")');
    expect(service).not.toContain('.from("payroll_');
  });

  it("uses a foundation-only run and reserves Paid for a later settlement authority", () => {
    expect(migration).toContain("foundation_only boolean not null default true check(foundation_only)");
    expect(migration).toContain("current_finalized_run_id uuid");
    expect(migration).toContain("supersedes_run_id uuid references public.payroll_runs");
    expect(migration).toContain("No Paid transition until settlement authority exists");
    expect(page).toContain("No payslip or payment is created.");
    expect(page).toContain("Adjust Compensation");
    expect(page).toContain("Compensation History");
    expect(page).toContain("Ready and Finalize require complete time, pay and statutory evidence");
    expect(page).not.toContain("window.prompt");
    expect(page).toContain('rate: previous.payBasis === value ? previous.rate : ""');
  });

  it("projects finalized approver identity only through the scoped Payroll read", () => {
    expect(approverProjection).toContain("perform public.payroll_admin_actor()");
    expect(approverProjection).toContain("public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view')");
    expect(approverProjection).toContain("'finalized_by_name', actor.full_name");
    expect(approverProjection).toContain("actor.id=r.finalized_by_employee_id");
    expect(approverProjection).toContain("revoke all on function public.payroll_foundation_read(uuid,uuid) from public,anon");
  });
});
