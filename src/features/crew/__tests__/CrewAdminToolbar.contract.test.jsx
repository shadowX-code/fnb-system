import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageFiles = [
  "src/features/crew/pages/CrewWorkspacePage.jsx",
  "src/features/crew/pages/CrewOperationsAdminPage.jsx",
  "src/features/crew/pages/CrewAttendanceAdminPage.jsx",
  "src/features/crew/pages/CrewLeaveAdminPage.jsx",
  "src/features/crew/pages/CrewLearningAdminResetPage.jsx",
  "src/features/crew/pages/CrewSopLibraryPage.jsx",
  "src/features/crew/pages/CrewGrowthAdminPage.jsx",
  "src/features/crew/pages/CrewPerformanceAdminPage.jsx",
  "src/features/crew/pages/CrewRewardAdminPage.jsx",
  "src/features/sales-purchase/pages/DutyRosterPage.jsx",
];

const source = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("Crew Admin toolbar contract", () => {
  it.each(pageFiles)("uses the shared toolbar on %s", (file) => {
    expect(source(file)).toContain("CrewAdminToolbar");
  });

  it.each(pageFiles)("keeps controls out of PageHeader actions on %s", (file) => {
    const contents = source(file);
    expect(contents).not.toMatch(/<PageHeader[\s\S]{0,500}?\sactions=/);
  });

  it("wraps all routed Admin pages in the shared Outlet provider", () => {
    const app = source("src/app/AdminApp.jsx");
    expect(app).toContain("<CrewAdminOutletProvider outlets={effectiveStore.outlets}>");
    expect(app).toContain("</CrewAdminOutletProvider>");
  });

  it("uses the server-scoped Crew Access employee read instead of matching workplace text in the browser", () => {
    const contents = source("src/features/crew/pages/CrewWorkspacePage.jsx");
    expect(contents).toContain("employeeService.listCrewAccessEmployees(outletId)");
    expect(contents).not.toContain("employee.workplace ===");
  });
});
