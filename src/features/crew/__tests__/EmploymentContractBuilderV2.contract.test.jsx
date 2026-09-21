import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921110000_employment_contract_builder_v2.sql"), "utf8");
const legalEmployerGuardFix = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921110200_employment_documents_legal_employer_assignment_guard_fix.sql"), "utf8");
const edgeFunction = readFileSync(resolve(process.cwd(), "supabase/functions/employee-employment-documents/index.ts"), "utf8");
const panel = readFileSync(resolve(process.cwd(), "src/features/company-users/components/EmployeeEmploymentDocumentsPanel.jsx"), "utf8");

describe("People Employment Contract Builder V2 authority", () => {
  it("keeps legal-entity templates versioned, published and defaultable without a generic builder", () => {
    expect(migration).toContain("create table public.employment_contract_templates");
    expect(migration).toContain("create table public.employment_contract_template_versions");
    expect(migration).toContain("contract_kind in ('full_time','part_time')");
    expect(migration).toContain("employment_contract_templates_default_unique");
    expect(migration).toContain("Published employment contract template versions are immutable");
    expect(migration).toContain("employment_contract_template_sections_valid");
    expect(migration).toContain("allowances_table");
  });

  it("creates a server-derived manifest and makes stale generated previews unsendable", () => {
    expect(migration).toContain("employment_contract_document_manifest");
    expect(migration).toContain("render_manifest_sha256");
    expect(migration).toContain("The contract preview is stale. Generate the exact PDF again before sending.");
    expect(migration).toContain("contract_terms_snapshot");
    expect(migration).toContain("Sent employment document content is immutable");
  });

  it("uses server-side PDF generation and keeps the existing V1 PDF evidence authority", () => {
    expect(edgeFunction).toContain('from "npm:pdf-lib@1.17.1"');
    expect(edgeFunction).toContain('body?.action === "contract_preview"');
    expect(edgeFunction).toContain("employee_employment_contract_render_finalize_service");
    expect(edgeFunction).toContain('body?.action === "template_preview"');
    expect(edgeFunction).toContain('crypto.subtle.digest("SHA-256", bytes)');
    expect(panel).toContain("Create Contract");
    expect(panel).toContain("Upload Existing");
  });

  it("does not change Crew acknowledgement into an electronic-signature claim", () => {
    expect(migration).toContain("it is not represented by FeedX as a legal electronic signature");
    expect(migration).toContain("crew_session_acknowledgement");
  });

  it("validates an employee's active legal employer through the trusted assignment guard", () => {
    expect(legalEmployerGuardFix).toContain("security definer");
    expect(legalEmployerGuardFix).toContain("Choose an active legal employer.");
    expect(legalEmployerGuardFix).toContain("revoke all on function public.employee_legal_entity_assignment_guard()");
  });
});
