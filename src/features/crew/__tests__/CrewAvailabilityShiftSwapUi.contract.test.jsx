import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mobile = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewAvailabilityMobile.jsx"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const admin = readFileSync(resolve(process.cwd(), "src/features/crew/pages/CrewShiftRequestsAdminPage.jsx"), "utf8");
const roster = readFileSync(resolve(process.cwd(), "src/features/sales-purchase/pages/DutyRosterPage.jsx"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/services/crewService.js"), "utf8");

describe("Crew Availability and Shift Swap v1 UI", () => {
  it("keeps Availability and Shift Requests under Me without adding bottom navigation", () => {
    expect(app).toContain('<span>Availability</span>');
    expect(app).toContain('<span>Shift Requests</span>');
    expect(app).not.toContain('{ id: "availability"');
    expect(app).not.toContain('{ id: "shiftRequests"');
  });

  it("supports weekly windows, exceptions and specific or open cover", () => {
    for (const copy of ["Weekly Availability", "Temporary Exceptions", "Add time", "Request Specific Crew", "Open for Cover", "Submit Request"]) expect(mobile).toContain(copy);
    expect(mobile).toContain("Planning preference");
    expect(mobile).toContain("Your published roster remains your official schedule.");
  });

  it("exposes swap only from a future working published schedule entry", () => {
    expect(app).toContain('entry.entry_type === "working" && entry.date > roster?.from');
    expect(app).toContain("Request Swap");
    expect(app).toContain('setScreen("shiftSwap")');
  });

  it("shows manager verification and immutable approval semantics", () => {
    for (const copy of ["Same position / compatible", "No roster conflict", "No approved leave", "Availability compatible", "Outlet scope valid"]) expect(admin).toContain(copy);
    expect(admin).toContain("A new immutable roster revision is now live.");
    expect(admin).toContain("Rejection Reason *");
  });

  it("shows a roster planning warning and an explicit override reason", () => {
    expect(roster).toContain("Outside employee availability");
    expect(roster).toContain("Continue Anyway");
    expect(roster).toContain("Approved leave cannot be overridden.");
  });

  it("uses controlled RPCs rather than direct request-table access", () => {
    for (const rpc of ["crew_availability_mobile", "crew_availability_save", "crew_shift_candidates", "crew_shift_request_submit", "crew_shift_requests_mobile", "crew_shift_request_respond", "crew_shift_request_cancel", "crew_shift_requests_admin", "crew_shift_request_review"]) expect(service).toContain(`rpc("${rpc}"`);
    expect(service).not.toContain('from("crew_shift_requests")');
  });
});
