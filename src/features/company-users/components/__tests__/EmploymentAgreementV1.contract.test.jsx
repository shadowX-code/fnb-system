import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { employmentAgreementV1 } from "../../constants/employmentAgreementV1.js";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921134635_employment_agreement_v1_contract_tokens.sql"), "utf8");
const renderer = readFileSync(resolve(process.cwd(), "supabase/functions/employee-employment-documents/index.ts"), "utf8");
const templateWorkspace = readFileSync(resolve(process.cwd(), "src/features/company-users/components/ContractTemplatesWorkspace.jsx"), "utf8");
const draftPreviewMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922020000_employment_contract_template_draft_preview.sql"), "utf8");

describe("Employment Agreement V1", () => {
  it("is a reusable Malaysian agreement without reference-person or employer data", () => {
    const content = JSON.stringify(employmentAgreementV1);
    expect(employmentAgreementV1.title).toBe("Employment Agreement V1");
    expect(employmentAgreementV1.sections).toHaveLength(16);
    expect(content).not.toMatch(/Supreme|Lee Ye|1341883|Service Crew/);
    expect(content).toContain("{{annual_leave_table}}");
    expect(content).toContain("{{sick_hospitalisation_leave_table}}");
    expect(content).toContain("{{signature_block}}");
  });

  it("extends the existing V2 manifest with bounded People identity and agreement terms", () => {
    expect(migration).toContain("add column if not exists residential_address text");
    expect(migration).toContain("employee.ic_no");
    expect(migration).toContain("employee.residential_address");
    expect(migration).toContain("probation_notice_period_value");
    expect(migration).toContain("confirmed_notice_period_value");
    expect(migration).toContain("employer_signatory_name");
    expect(migration).toContain("set search_path=public");
  });

  it("renders leave tables and the signature block through the existing server PDF authority", () => {
    expect(renderer).toContain("drawAnnualLeaveTable");
    expect(renderer).toContain("drawSickHospitalisationLeaveTable");
    expect(renderer).toContain("drawSignatureBlock");
    expect(renderer).toContain("employee.residential_address");
    expect(renderer).toContain("employee_employment_contract_render_finalize_service");
  });

  it("keeps the standard agreement editable through a compact clause workspace and previews with the same renderer", () => {
    expect(templateWorkspace).toContain("Use Employment Agreement V1");
    expect(templateWorkspace).toContain("Insert Variable");
    expect(templateWorkspace).toContain("Preview as Employee");
    expect(templateWorkspace).toContain("Preview never publishes");
    expect(templateWorkspace).toContain("Preview has changes");
    expect(templateWorkspace).toContain("Open Full Preview");
    expect(templateWorkspace).toContain("selectedVersionId");
    expect(draftPreviewMigration).toContain("employment_contract_template_preview_context");
    expect(draftPreviewMigration).toContain("employment_contract_template_preview_employees");
    expect(draftPreviewMigration).toContain("'sections',version.sections");
    expect(draftPreviewMigration).toContain("never create an employment document");
    expect(renderer).toContain('body?.action === "template_preview"');
    expect(renderer).toContain("renderContractPdf(manifest)");
    expect(renderer).toContain("page_count: pageCount");
  });
});
