import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mobile = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.jsx"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/features/crew/pages/CrewLeaveAdminPage.jsx"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/crewService.js"), "utf8");

describe("Crew Leave v1 UI contracts", () => {
  it("keeps Leave under Me without changing the five-tab bottom navigation", () => {
    expect(app).toContain('setScreen("leave")');
    expect(app).toContain('<span>Leave</span>');
    expect(app).toContain('{ id: "home", label: "Home"');
    expect(app).not.toContain('{ id: "leave", label: "Leave"');
  });

  it("implements the four-step application with authoritative balances and no required uploads", () => {
    for (const copy of ["Leave Type", "Dates", "Reason", "Review Request", "Submit Request"]) expect(mobile).toContain(copy);
    for (const copy of ["Available", "Requested", "After", "Insufficient leave balance"]) expect(mobile).toContain(copy);
    expect(mobile).toContain("Supporting document not uploaded");
    expect(mobile).not.toContain("Balance 8.5");
  });

  it("supports pending cancellation and safe rejected/approved guidance", () => {
    expect(mobile).toContain("Cancel Request");
    expect(mobile).toContain("Contact your manager to change approved leave.");
    expect(mobile).toContain("item.rejection_reason");
  });

  it("shows manager roster context and requires a rejection reason", () => {
    expect(admin).toContain("Roster Context");
    expect(admin).toContain("Approval preserves the superseded roster evidence.");
    expect(admin).toContain("reason.trim().length < 2");
  });

  it("uses only controlled leave RPCs from the frontend", () => {
    for (const rpc of ["crew_leave_mobile", "crew_leave_submit", "crew_leave_cancel", "crew_leave_admin_data", "crew_leave_review", "crew_leave_policy_save", "crew_leave_adjust"]) expect(service).toContain(`rpc("${rpc}"`);
    expect(service).not.toContain('from("crew_leave_requests")');
  });

  it("adds manager balance, adjustment and policy contexts without a second sidebar route", () => {
    for (const copy of ["Balances", "Settings", "Balance Context", "Adjust Leave Balance", "Leave Policy"]) expect(admin).toContain(copy);
    expect(admin).toContain('auth.hasPermission("crew_leave_balance.adjust")');
    expect(admin).toContain('auth.hasPermission("crew_leave_settings.manage")');
  });
});
