import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  employees: vi.fn(), positions: vi.fn(), mappings: vi.fn(), templates: vi.fn(), allTemplates: vi.fn(), rosters: vi.fn(), period: vi.fn(), snapshot: vi.fn(), notify: vi.fn(),
}));

vi.mock("../../../../services/jobPositionService.js", () => ({ jobPositionService: { listJobPositions: mocks.positions } }));
vi.mock("../../../../services/rosterPositionGroupService.js", () => ({ rosterPositionGroupService: { listMappings: mocks.mappings } }));
vi.mock("../../../../services/shiftTemplateService.js", () => ({ shiftTemplateService: { listShiftTemplates: mocks.templates, listAllShiftTemplates: mocks.allTemplates } }));
vi.mock("../../../../services/dutyRosterService.js", () => ({ dutyRosterService: { listRosterEligibleEmployees: mocks.employees, listDutyRosters: mocks.rosters, saveRosterWeekSnapshot: mocks.snapshot } }));
vi.mock("../../../../services/rosterPeriodService.js", () => ({ rosterPeriodService: { getOrCreateRosterPeriod: mocks.period } }));

import DutyRosterPage, { rosterPermission } from "../DutyRosterPage.jsx";

const outlet = { id: "outlet-1", name: "Main Outlet", status: "active" };
const employee = { id: "employee-1", full_name: "Aina", nickname: "Aina", position: "Cook", department: "Kitchen", workplace: "outlet-1", employment_status: "active", is_active: true, roster_eligible: true };
const template = { id: "template-1", outlet_id: "outlet-1", name: "Morning", code: "MORNING", start_time: "09:00", end_time: "17:00", break_minutes: 60, shift_type: "working", color: "green" };
const eveningTemplate = { id: "template-2", outlet_id: "outlet-1", name: "Evening", code: "EVENING", start_time: "14:00", end_time: "22:00", break_minutes: 60, shift_type: "working", color: "blue" };
const leaveTemplate = { id: "leave-1", outlet_id: "outlet-1", name: "Annual Leave", code: "AL", start_time: null, end_time: null, break_minutes: 0, shift_type: "annual_leave", color: "purple", is_active: true };
const period = { id: "period-1", outlet_id: "outlet-1", week_start_date: "2026-08-10", week_end_date: "2026-08-16", status: "draft" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.employees.mockResolvedValue([employee]);
  mocks.positions.mockResolvedValue([{ id: "position-1", name: "Cook" }]);
  mocks.mappings.mockResolvedValue([{ position_id: "position-1", group_name: "kitchen" }]);
  mocks.templates.mockResolvedValue([template]);
  mocks.allTemplates.mockResolvedValue([template]);
  mocks.rosters.mockResolvedValue([]);
  mocks.period.mockResolvedValue(period);
  mocks.snapshot.mockResolvedValue({ period, rows: [] });
  mocks.notify.mockReset();
});

afterEach(() => cleanup());

describe("Duty Roster trusted week snapshot integration", () => {
  it("accepts only canonical Crew roster permissions", () => {
    const legacyAuth = { hasPermission: (code) => ["duty_roster.view", "duty_roster.manage"].includes(code) };
    const crewAuth = { hasPermission: (code) => ["crew_roster.view", "crew_roster.manage", "crew_roster.publish"].includes(code) };

    expect(rosterPermission(legacyAuth, "view")).toBe(false);
    expect(rosterPermission(legacyAuth, "manage")).toBe(false);
    expect(rosterPermission(legacyAuth, "publish")).toBe(false);
    expect(rosterPermission(crewAuth, "view")).toBe(true);
    expect(rosterPermission(crewAuth, "manage")).toBe(true);
    expect(rosterPermission(crewAuth, "publish")).toBe(true);
  });

  it("uses global cell selection and routes bulk assignment through the trusted week snapshot", async () => {
    let resolveSnapshot;
    mocks.snapshot.mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    const confirm = vi.fn();
    const auth = { isProtectedRole: true, hasPermission: (key) => ["duty_roster.view", "duty_roster.create", "duty_roster.edit"].includes(key) };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm }} auth={auth} />);
    const bulk = await screen.findByRole("button", { name: /Bulk Assign/ });
    fireEvent.click(bulk);
    fireEvent.pointerDown(screen.getAllByRole("button", { name: /Aina, .*unassigned/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Bulk shift template" }));
    fireEvent.click(screen.getByRole("button", { name: /Morning ·/ }));
    const submit = screen.getByRole("button", { name: /Apply to 1/ });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", rows: expect.arrayContaining([expect.objectContaining({ employee_id: "employee-1", shift_template_id: "template-1" })]) }));
    resolveSnapshot({ period, rows: [] });
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Bulk assignment saved" })));
    expect(screen.getByText("0 cells selected")).toBeTruthy();
  });

  it("preserves selection after a failed bulk save and prevents duplicate submissions", async () => {
    let rejectSnapshot;
    mocks.snapshot.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectSnapshot = reject; }));
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    fireEvent.pointerDown(screen.getAllByRole("button", { name: /Aina, .*unassigned/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Bulk shift template" }));
    fireEvent.click(screen.getByRole("button", { name: /Morning ·/ }));
    const submit = screen.getByRole("button", { name: /Apply to 1/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1));
    rejectSnapshot(new Error("Selected employee is no longer schedulable."));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to bulk assign" })));
    expect(screen.getByText("1 cell selected")).toBeTruthy();
  });

  it("requires an explicit overwrite state for an existing working shift without opening a confirmation modal", async () => {
    mocks.templates.mockResolvedValue([template, eveningTemplate]);
    mocks.allTemplates.mockResolvedValue([template, eveningTemplate]);
    mocks.rosters.mockResolvedValue([{ id: "shift-1", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-08-10", shift_template_id: "template-1", template, status: "draft" }]);
    mocks.snapshot.mockResolvedValue({ period, rows: [] });
    const confirm = vi.fn();
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm }} auth={auth} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /Aina, 2026-08-10, Morning/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk shift template" }));
    fireEvent.click(screen.getByRole("button", { name: /Evening ·/ }));
    expect(screen.getByText(/1 existing shifts/)).toBeTruthy();
    const apply = screen.getByRole("button", { name: /Apply to 1/ });
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Allow overwrite (1)" }));
    expect(screen.getByRole("button", { name: "Overwrite enabled (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Apply to 1/ }));
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("loads roster candidates from the server-authoritative outlet eligibility RPC", async () => {
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    expect((await screen.findAllByText("Aina")).length).toBeGreaterThan(0);
    expect(screen.queryByText("BBB N")).toBeNull();
    expect(mocks.employees).toHaveBeenCalledWith("outlet-1");
  });

  it("keeps an unrelated historical ineligible snapshot visible but not selectable", async () => {
    mocks.employees.mockResolvedValue([]);
    mocks.rosters.mockResolvedValue([{
      id: "historical-row", outlet_id: "outlet-1", employee_id: "employee-stale", roster_date: "2026-08-10",
      shift_template_id: "template-1", template, status: "published",
      employee_snapshot: { id: "employee-stale", full_name: "Former Crew", nickname: "Former Crew", position: "Cook", is_roster_snapshot: true },
    }]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    const staleCell = screen.getByRole("button", { name: /Former Crew, 2026-08-10, Morning, not eligible for this outlet/ });
    expect(staleCell.getAttribute("aria-disabled")).toBe("true");
    fireEvent.pointerDown(staleCell);
    expect(screen.getByText("0 cells selected")).toBeTruthy();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("keeps approved Leave projection visible and protected from roster edits and bulk assignment", async () => {
    mocks.rosters.mockResolvedValue([{ id: "leave-row", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-08-10", shift_template_id: "leave-1", template: leaveTemplate, source: "approved_leave", approved_leave_id: "approved-1", status: "draft" }]);
    mocks.allTemplates.mockResolvedValue([template, leaveTemplate]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn().mockResolvedValue(true) }} auth={auth} />);
    const leaveCell = await screen.findByRole("button", { name: /Aina, 2026-08-10, Annual Leave, protected leave/ });
    expect(screen.getAllByText("Approved leave").length).toBeGreaterThan(0);
    fireEvent.click(leaveCell);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Approved leave" }));
    fireEvent.click(screen.getByRole("button", { name: /Bulk Assign/ }));
    fireEvent.pointerDown(leaveCell);
    expect(screen.getByText("0 empty · 0 existing shifts · 1 protected leave")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to 0" }).disabled).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("keeps Leave-owned templates out of roster template selection and settings", async () => {
    mocks.templates.mockResolvedValue([template, leaveTemplate]);
    mocks.allTemplates.mockResolvedValue([template, leaveTemplate]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    await screen.findByRole("button", { name: "Shift Template" });
    fireEvent.click(screen.getByRole("button", { name: "Shift Template" }));
    expect(screen.getByRole("button", { name: /Morning/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Annual Leave/ })).toBeNull();
  });
});
