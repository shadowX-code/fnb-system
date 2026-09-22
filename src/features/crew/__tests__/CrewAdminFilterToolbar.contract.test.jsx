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

const actionOwnershipFiles = [
  "src/features/crew/pages/CrewOperationsAdminPage.jsx",
  "src/features/crew/pages/CrewCashCheckoutAdminPage.jsx",
  "src/features/sales-purchase/pages/DutyRosterPage.jsx",
  "src/features/crew/pages/CrewLearningAdminResetPage.jsx",
  "src/features/crew/pages/CrewSopLibraryPage.jsx",
  "src/features/crew/pages/CrewGrowthAdminPage.jsx",
  "src/features/crew/pages/CrewPerformanceAdminPage.jsx",
  "src/features/crew/pages/CrewRewardAdminPage.jsx",
];

const source = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("Crew Admin filter toolbar contract", () => {
  it.each(pageFiles)("uses the canonical Admin filter toolbar on %s", (file) => {
    expect(source(file)).toContain("AdminFilterToolbar");
  });

  it.each(actionOwnershipFiles)("keeps page-level commands out of AdminFilterToolbar on %s", (file) => {
    const contents = source(file);
    expect(contents).not.toMatch(/<AdminFilterToolbar[\s\S]{0,1600}?\s(?:secondaryActions|primaryActions)=/);
  });

  it.each(actionOwnershipFiles)("uses PageHeader action groups for page-level commands on %s", (file) => {
    const contents = source(file);
    expect(contents).toMatch(/<PageHeader[\s\S]{0,800}?\s(?:secondaryActions|primaryActions)=/);
  });

  it("wraps all routed Admin pages in the shared Outlet provider", () => {
    const app = source("src/app/AdminApp.jsx");
    expect(app).toContain("<CrewAdminOutletProvider outlets={effectiveStore.outlets}>");
    expect(app).toContain("</CrewAdminOutletProvider>");
  });

  it("uses the server-scoped Crew Access read instead of matching workplace text in the browser", () => {
    const contents = source("src/features/crew/pages/CrewWorkspacePage.jsx");
    expect(contents).toContain("employeeService.crewAccessAdminPage");
    expect(contents).not.toContain("employee.workplace ===");
  });
});
