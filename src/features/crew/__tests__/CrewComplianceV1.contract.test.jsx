import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mobile = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewComplianceMobile.jsx"), "utf8");
const me = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewMeMobile.jsx"), "utf8");
const route = readFileSync(resolve(process.cwd(), "src/features/crew/crewRoute.js"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/features/company-users/pages/EmployeeCompliancePage.jsx"), "utf8");

describe("Employee Compliance V1 surfaces", () => {
  it("activates Documents & Compliance from Me", () => {
    expect(me).toContain('navigate("compliance")');
    expect(route).toContain('"me/compliance"');
  });

  it("requires one prepared photo and expiry only for configured requirements", () => {
    expect(mobile).toContain("optional={false}");
    expect(mobile).toContain("selected.requires_expiry");
    expect(mobile).toContain("optimizeImageBlob");
  });

  it("explains replacement effectiveness and rejected resubmission", () => {
    expect(mobile).toContain("replacement_pending");
    expect(mobile).toContain("effectiveWhilePending");
    expect(mobile).toContain("resubmit");
  });

  it("uses shared Admin filters, summaries, tables and server pagination", () => {
    expect(admin).toContain("AdminFilterToolbar");
    expect(admin).toContain("AdminSummaryGrid");
    expect(admin).toContain("AdminDataSection");
    expect(admin).toContain("useAdminPagedQuery");
    expect(admin).toContain("AdminPagination");
  });
});
