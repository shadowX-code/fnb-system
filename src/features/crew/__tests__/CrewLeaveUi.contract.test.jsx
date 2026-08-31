import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mobile = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewLeaveMobile.jsx"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/features/crew/pages/CrewLeaveAdminPage.jsx"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const me = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewMeMobile.jsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/crewService.js"), "utf8");

describe("Crew Leave v1 UI contracts", () => {
  it("keeps Leave under Me without changing the five-tab bottom navigation", () => {
    expect(me).toContain('navigate("leave")');
    expect(me).toContain('t("me.leave")');
    expect(app).toContain('{ id: "home", label: "Home"');
    expect(app).not.toContain('{ id: "leave", label: "Leave"');
  });

  it("implements the four-step application with authoritative balances and no required uploads", () => {
    for (const key of ["leave.leaveType", "leave.dates", "leave.reason", "leave.review", "leave.submitRequest"]) expect(mobile).toContain(`t("${key}")`);
    for (const key of ["leave.available", "leave.requested", "leave.after", "leave.insufficient"]) expect(mobile).toContain(`t("${key}")`);
    expect(mobile).toContain('t("leave.documentNotUploaded")');
    expect(mobile).not.toContain("Balance 8.5");
  });

  it("supports pending cancellation and safe rejected/approved guidance", () => {
    expect(mobile).toContain('t("leave.cancelRequest")');
    expect(mobile).toContain('t("leave.approvedChangeHelp")');
    expect(mobile).toContain("item.rejection_reason");
    expect(mobile).toContain("crew-leave-guidance");
    expect(mobile).toContain('t("leave.availableDays"');
  });

  it("shows manager roster context and requires a rejection reason", () => {
    expect(admin).toContain("Roster impact");
    expect(admin).toContain("No published roster");
    expect(admin).toContain("!reason.trim()");
  });

  it("uses only controlled leave RPCs from the frontend", () => {
    for (const rpc of ["crew_leave_mobile", "crew_leave_submit", "crew_leave_cancel", "crew_leave_admin_data", "crew_leave_review", "crew_leave_policy_save", "crew_leave_adjust", "crew_leave_adjustment_history"]) expect(service).toContain(`rpc("${rpc}"`);
    expect(service).not.toContain('from("crew_leave_requests")');
  });

  it("adds manager balance, adjustment and policy contexts without a second sidebar route", () => {
    for (const copy of ["Balances", "Settings", "Balance summary", "Adjust Leave Balance", "Adjustment History", "Leave Policy", "One employee per row", "Expiry month"]) expect(admin).toContain(copy);
    expect(admin).toContain('auth.hasPermission("crew_leave_balance.adjust")');
    expect(admin).toContain('auth.hasPermission("crew_leave_settings.manage")');
  });
});
