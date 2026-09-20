import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260920170000_employee_compliance_v1.sql"), "utf8");
const edge = readFileSync(resolve(process.cwd(), "supabase/functions/employee-compliance-evidence/index.ts"), "utf8");

describe("Employee Compliance V1 authority", () => {
  it("uses requirement records rather than employee columns", () => {
    expect(sql).toContain("employee_compliance_requirements");
    expect(sql).toContain("food_handler_certificate");
    expect(sql).toContain("typhoid_injection");
    expect(sql).not.toMatch(/alter table public\.employees[\s\S]*food_handler/);
  });

  it("keeps submissions and reviews immutable behind trusted functions", () => {
    expect(sql).toContain("revoke all on public.employee_compliance_requirements, public.employee_compliance_submissions, public.employee_compliance_reviews");
    expect(sql).toContain("submission_id uuid not null unique");
    expect(sql).toContain("employee_compliance_rejection_reason check");
    expect(sql).toContain("Rejection reason is required.");
    expect(sql).not.toMatch(/grant (insert|update|delete) on public\.employee_compliance/i);
  });

  it("derives expiry server-side and preserves an effective verified replacement", () => {
    expect(sql).toContain("Asia/Kuala_Lumpur");
    expect(sql).toContain("verified_expiry <= p_business_date + expiring_soon_days");
    expect(sql).toContain("'replacement_pending'");
    expect(sql).toContain("'effective_status',effective_status");
  });

  it("derives Crew identity from the opaque session token", () => {
    expect(sql).toMatch(/crew_employee_compliance\(p_token text\)[\s\S]*crew_session_employee\(p_token\)/);
    expect(sql).toMatch(/crew_employee_compliance_submit_context[\s\S]*crew_session_employee\(p_token\)/);
    expect(sql).not.toMatch(/crew_employee_compliance_submit_context\([^)]*employee_id/i);
  });

  it("keeps evidence private and signed through the dedicated authority", () => {
    expect(sql).toContain("'employee-compliance-evidence','employee-compliance-evidence',false");
    expect(edge).toContain("createSignedUrl");
    expect(edge).not.toContain("getPublicUrl");
    expect(edge).toContain("crew_employee_compliance_evidence_context");
    expect(edge).toContain("employee_compliance_admin_evidence_context");
  });

  it("provides server paging and dedicated review permissions", () => {
    expect(sql).toContain("employee_compliance_admin_page");
    expect(sql).toContain("'total_count',v_total");
    expect(sql).toContain("employee_compliance.review");
    expect(sql).toContain("current_user_can_access_outlet");
  });
});
