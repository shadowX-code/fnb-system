import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCrewRoute } from "../crewRoute.js";

const mobile = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewComplianceMobile.jsx"), "utf8");
const employmentRecords = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewEmploymentRecordsMobile.jsx"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/EmployeeCompliancePage.jsx"), "utf8");
const crewLocale = readFileSync(resolve(process.cwd(), "src/locales/en/crew.js"), "utf8");

describe("Food Handling Compliance V1 surfaces", () => {
  it("activates Food Handling Compliance from Employment Records", () => {
    expect(employmentRecords).toContain('id: "compliance"');
    expect(parseCrewRoute("#crew/me/employment-records/documents-compliance")?.screen).toBe("compliance");
    expect(crewLocale).toContain('compliance:"Food Handling Compliance"');
    expect(crewLocale).toContain('title: "Food Handling Compliance"');
  });

  it("requires one prepared photo and expiry only for configured requirements", () => {
    expect(mobile).toContain("optional={false}");
    expect(mobile).toContain("formItem.requires_expiry");
    expect(mobile).toContain("optimizeImageBlob");
  });

  it("explains replacement effectiveness and rejected resubmission", () => {
    expect(mobile).toContain("replacement_pending");
    expect(mobile).toContain("effectiveWhilePending");
    expect(mobile).toContain("resubmit");
  });

  it("uses shared Admin filters, summaries, tables and server pagination", () => {
    expect(admin).toContain("AdminFilterToolbar");
    expect(admin).toContain("AdminSearchField");
    expect(admin).toContain("AdminSummaryGrid");
    expect(admin).toContain("AdminDataSection");
    expect(admin).toContain("useAdminPagedQuery");
    expect(admin).toContain("AdminPagination");
    expect(admin).not.toContain('title="Compliance Records"');
  });

  it("uses shared Crew sheets and private signed evidence viewing", () => {
    expect(mobile).toContain("CrewBottomSheet");
    expect(mobile).toContain("CrewEvidencePhotoPicker");
    expect(mobile).toContain("crewEvidenceUrl");
    expect(mobile).toContain("CrewImageViewer");
  });

  it("only exposes review or evidence actions when a submission exists", () => {
    expect(admin).toContain("submissionIdFor(row) ?");
    expect(admin).toContain('row.state?.status === "pending_verification" ? "Review" : "View"');
  });
});
