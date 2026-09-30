import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  employees: vi.fn(), positions: vi.fn(), mappings: vi.fn(), templates: vi.fn(), allTemplates: vi.fn(), rosters: vi.fn(), period: vi.fn(), snapshot: vi.fn(), publish: vi.fn(), notify: vi.fn(),
}));

vi.mock("../../../../services/jobPositionService.js", () => ({ jobPositionService: { listJobPositions: mocks.positions } }));
vi.mock("../../../../services/rosterPositionGroupService.js", () => ({ rosterPositionGroupService: { listMappings: mocks.mappings } }));
vi.mock("../../../../services/shiftTemplateService.js", () => ({ shiftTemplateService: { listShiftTemplates: mocks.templates, listAllShiftTemplates: mocks.allTemplates } }));
vi.mock("../../../../services/dutyRosterService.js", () => ({ dutyRosterService: { listRosterEligibleEmployees: mocks.employees, listDutyRosters: mocks.rosters, saveRosterWeekSnapshot: mocks.snapshot, publishRosterWeek: mocks.publish } }));
vi.mock("../../../../services/rosterPeriodService.js", () => ({ rosterPeriodService: { getOrCreateRosterPeriod: mocks.period } }));

import DutyRosterPage, { RosterDateSelector, rosterPermission } from "../DutyRosterPage.jsx";

const outlet = { id: "outlet-1", name: "Main Outlet", status: "active" };
const employee = { id: "employee-1", full_name: "Aina", nickname: "Aina", position: "Cook", department: "Kitchen", workplace: "outlet-1", employment_status: "active", is_active: true,
  eligibility_by_date: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [new Date(Date.UTC(2026, 9, 5 + index)).toISOString().slice(0, 10), { state: "eligible", employment_status: "active" }])) };
const template = { id: "template-1", outlet_id: "outlet-1", name: "Morning", code: "MORNING", start_time: "09:00", end_time: "17:00", break_minutes: 60, shift_type: "working", color: "green" };
const eveningTemplate = { id: "template-2", outlet_id: "outlet-1", name: "Evening", code: "EVENING", start_time: "14:00", end_time: "22:00", break_minutes: 60, shift_type: "working", color: "blue" };
const leaveTemplate = { id: "leave-1", outlet_id: "outlet-1", name: "Annual Leave", code: "AL", start_time: null, end_time: null, break_minutes: 0, shift_type: "annual_leave", color: "purple", is_active: true };
const period = { id: "period-1", outlet_id: "outlet-1", week_start_date: "2026-10-05", week_end_date: "2026-10-11", status: "draft" };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-05T12:00:00"));
  vi.clearAllMocks();
  mocks.employees.mockResolvedValue([employee]);
  mocks.positions.mockResolvedValue([{ id: "position-1", name: "Cook" }]);
  mocks.mappings.mockResolvedValue([{ position_id: "position-1", group_name: "kitchen" }]);
  mocks.templates.mockResolvedValue([template]);
  mocks.allTemplates.mockResolvedValue([template]);
  mocks.rosters.mockResolvedValue([]);
  mocks.period.mockResolvedValue(period);
  mocks.snapshot.mockResolvedValue({ period, rows: [] });
  mocks.publish.mockResolvedValue({ period: { ...period, status: "published", has_unpublished_changes: false }, rows: [] });
  mocks.notify.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Duty Roster trusted week snapshot integration", () => {
  it("keeps week navigation controls square, separate, and interactive", () => {
    const previous = vi.fn();
    const next = vi.fn();
    render(<RosterDateSelector mode="week" weekStart="2026-09-21" weekDates={Array.from({ length: 7 }, (_, index) => new Date(2026, 8, 21 + index))} visibleDates={[new Date(2026, 8, 21)]} onSelectDate={vi.fn()} onPrevious={previous} onNext={next} />);
    const previousButton = screen.getByRole("button", { name: "Previous week" });
    const nextButton = screen.getByRole("button", { name: "Next week" });
    expect(previousButton.className).toContain("admin-date-range-navigation-button");
    expect(nextButton.className).toContain("admin-date-range-navigation-button");
    expect(screen.getByText("21 Sept - 27 Sept 2026").closest("button").className).toContain("admin-date-range-navigation-trigger");
    fireEvent.click(previousButton);
    fireEvent.click(nextButton);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

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

  it("uses the same Bulk selection state in the narrow card layout instead of opening the shift drawer", async () => {
    const auth = { isProtectedRole: true, hasPermission: () => true };
    const { container } = render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    const mobileCell = container.querySelector('div.lg\\:hidden div[role="button"][aria-label="Aina, 2026-10-05, unassigned"]');
    expect(mobileCell).toBeTruthy();
    fireEvent.click(mobileCell);
    expect(screen.getByText("1 cell selected")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Aina" })).toBeNull();
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
    mocks.rosters.mockResolvedValue([{ id: "shift-1", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-10-05", shift_template_id: "template-1", template, status: "draft" }]);
    mocks.snapshot.mockResolvedValue({ period, rows: [] });
    const confirm = vi.fn();
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm }} auth={auth} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    fireEvent.pointerDown(screen.getAllByRole("button", { name: /Aina, 2026-10-05, Morning/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Bulk shift template" }));
    fireEvent.click(screen.getByRole("button", { name: /Evening ·/ }));
    expect(screen.getByText(/1 working/)).toBeTruthy();
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
    expect(mocks.employees).toHaveBeenCalledWith("outlet-1", "2026-10-05", "2026-10-11");
  });

  it("defaults to Active and combines Employment Status with the existing search and filter chips", async () => {
    const former = { ...employee, id: "employee-2", full_name: "Ben", nickname: "Ben", employment_status: "resigned",
      eligibility_by_date: Object.fromEntries(Object.keys(employee.eligibility_by_date).map((date) => [date, { state: "inactive", employment_status: "resigned" }])) };
    mocks.employees.mockResolvedValue([employee, former]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);

    expect((await screen.findAllByRole("button", { name: /Aina, 2026-10-05/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Ben, 2026-10-05/ })).toBeNull();
    expect(screen.getByText("Employment Status: Active")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Employment Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Resigned" }));
    expect((await screen.findAllByRole("button", { name: /Ben, 2026-10-05/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Aina, 2026-10-05/ })).toBeNull();
    expect(screen.getByText("Employment Status: Resigned")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Employment Status filter" }));
    expect(screen.getByRole("button", { name: "Employment Status" }).textContent).toContain("All");
    expect((await screen.findAllByRole("button", { name: /Aina, 2026-10-05/ })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: /Ben, 2026-10-05/ })).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText("Search name..."), { target: { value: "Ben" } });
    expect(screen.queryByRole("button", { name: /Aina, 2026-10-05/ })).toBeNull();
    expect(screen.getByText("Employee: Ben")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect((await screen.findAllByRole("button", { name: /Aina, 2026-10-05/ })).length).toBeGreaterThan(0);
  });

  it("uses dated People status in both week and month views after a later resignation", async () => {
    const former = { ...employee, id: "employee-2", full_name: "Ben", nickname: "Ben", employment_status: "resigned" };
    mocks.employees.mockImplementation(async (_outletId, start, end) => {
      const dates = [];
      for (let date = new Date(`${start}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
      return [{ ...former, eligibility_by_date: Object.fromEntries(dates.map((date) => [date, date < "2026-10-05"
        ? { state: "eligible", employment_status: "active" }
        : { state: "inactive", employment_status: "resigned" }])) }];
    });
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);

    await waitFor(() => expect(mocks.employees).toHaveBeenCalledWith("outlet-1", "2026-10-05", "2026-10-11"));
    expect(screen.queryByRole("button", { name: /Ben, 2026-10-05/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect((await screen.findAllByRole("button", { name: /Ben, 2026-09-28/ })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "month" }));
    await waitFor(() => expect(mocks.employees).toHaveBeenCalledWith("outlet-1", "2026-09-01", "2026-09-30"));
    expect((await screen.findAllByRole("button", { name: /Ben, 2026-09-28/ })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(mocks.employees).toHaveBeenCalledWith("outlet-1", "2026-10-01", "2026-10-31"));
    expect((await screen.findAllByRole("button", { name: /Ben, 2026-10-01/ })).length).toBeGreaterThan(0);
  });

  it("uses the assignment for each roster date, including a mid-week transfer and position", async () => {
    mocks.employees.mockResolvedValue([{ ...employee, eligibility_by_date: {
      ...employee.eligibility_by_date,
      "2026-10-06": { state: "eligible", position: "Kitchen Crew" },
      "2026-10-07": { state: "other_outlet", position: "Supervisor" },
    } }]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    const before = (await screen.findAllByRole("button", { name: /Aina, 2026-10-06, Kitchen Crew, unassigned/ }))[0];
    const after = screen.getAllByRole("button", { name: /Aina, 2026-10-07, Supervisor, unassigned, employment eligibility unverified or unavailable for this outlet/ })[0];
    expect(before.getAttribute("aria-disabled")).toBe("false");
    expect(after.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(after);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("keeps an unrelated historical ineligible snapshot visible but not selectable", async () => {
    mocks.employees.mockResolvedValue([]);
    mocks.rosters.mockResolvedValue([{
      id: "historical-row", outlet_id: "outlet-1", employee_id: "employee-stale", roster_date: "2026-10-05",
      shift_template_id: "template-1", template, status: "published",
      employee_snapshot: { id: "employee-stale", full_name: "Former Crew", nickname: "Former Crew", position: "Cook", is_roster_snapshot: true },
    }]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    const staleCell = screen.getAllByRole("button", { name: /Former Crew, 2026-10-05, Morning, employment eligibility unverified or unavailable for this outlet/ })[0];
    expect(staleCell.getAttribute("aria-disabled")).toBe("true");
    fireEvent.pointerDown(staleCell);
    expect(screen.getByText("0 cells selected")).toBeTruthy();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("keeps approved Leave projection visible and protected from roster edits and bulk assignment", async () => {
    mocks.rosters.mockResolvedValue([{ id: "leave-row", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-10-05", shift_template_id: "leave-1", template: leaveTemplate, source: "approved_leave", approved_leave_id: "approved-1", status: "draft" }]);
    mocks.allTemplates.mockResolvedValue([template, leaveTemplate]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn().mockResolvedValue(true) }} auth={auth} />);
    const leaveCell = (await screen.findAllByRole("button", { name: /Aina, 2026-10-05, Annual Leave, protected leave/ }))[0];
    expect(screen.getAllByText("Approved leave").length).toBeGreaterThan(0);
    fireEvent.click(leaveCell);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Approved leave" }));
    fireEvent.click(screen.getByRole("button", { name: /Bulk Assign/ }));
    fireEvent.pointerDown(leaveCell);
    expect(screen.getByText("0 empty · 0 working · 0 removable · 1 protected leave")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply to 0" }).disabled).toBe(true);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("bulk removes working and OFF cells while preserving selected approved Leave", async () => {
    const offTemplate = { id: "off-1", outlet_id: "outlet-1", name: "OFF", code: "OFF", shift_type: "off", color: "gray" };
    const rows = [
      { id: "shift-1", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-10-05", shift_template_id: template.id, template, status: "draft" },
      { id: "leave-row", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-10-06", shift_template_id: leaveTemplate.id, template: leaveTemplate, source: "approved_leave", approved_leave_id: "approved-1", status: "draft" },
      { id: "off-row", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-10-07", shift_template_id: offTemplate.id, template: offTemplate, status: "draft" },
    ];
    mocks.rosters.mockResolvedValue(rows);
    mocks.snapshot.mockResolvedValue({ period, rows: [rows[1]] });
    mocks.allTemplates.mockResolvedValue([template, offTemplate, leaveTemplate]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);

    fireEvent.click(await screen.findByRole("button", { name: /Bulk Assign/ }));
    fireEvent.pointerDown(screen.getAllByRole("button", { name: /Aina, 2026-10-05, Morning/ })[0]);
    fireEvent.pointerDown(screen.getAllByRole("button", { name: /Aina, 2026-10-06, Annual Leave, protected leave/ })[0], { ctrlKey: true });
    fireEvent.pointerDown(screen.getAllByRole("button", { name: /Aina, 2026-10-07, OFF/ })[0], { ctrlKey: true });

    expect(screen.getByText("0 empty · 1 working · 2 removable · 1 protected leave")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove 2" }));
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1));
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      outletId: "outlet-1",
      rows: [expect.objectContaining({ id: "leave-row", approved_leave_id: "approved-1" })],
    }));
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Shifts removed", message: expect.stringContaining("approved leave cell was protected") }));
    expect((await screen.findAllByRole("button", { name: /Aina, 2026-10-05, unassigned/ })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: /Aina, 2026-10-07, unassigned/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Aina, 2026-10-06, Annual Leave, protected leave/ }).length).toBeGreaterThan(0);
  });

  it("removes one editable shift and updates the cell to empty immediately", async () => {
    mocks.rosters.mockResolvedValue([{ id: "shift-1", outlet_id: "outlet-1", employee_id: "employee-1", roster_date: "2026-10-05", shift_template_id: template.id, template, status: "draft" }]);
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Aina, 2026-10-05, Morning/ }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Shift" }));

    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      outletId: "outlet-1",
      weekStartDate: "2026-10-05",
      rows: [],
    })));
    expect((await screen.findAllByRole("button", { name: /Aina, 2026-10-05, unassigned/ })).length).toBeGreaterThan(0);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Shift removed" }));
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

  it("labels an edited published week and republishes through the trusted week authority", async () => {
    const publishedWithChanges = { ...period, status: "published", has_unpublished_changes: true, published_at: "2026-10-05T02:00:00Z" };
    mocks.period.mockResolvedValue(publishedWithChanges);
    mocks.publish.mockResolvedValue({ period: { ...publishedWithChanges, has_unpublished_changes: false }, rows: [] });
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);

    expect(await screen.findByText("Published · Unpublished changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Republish Roster" }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", weekStartDate: "2026-10-05" })));
  });

  it("publishes the selected week from Month view through the same authority", async () => {
    const auth = { isProtectedRole: true, hasPermission: () => true };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);

    fireEvent.click(await screen.findByRole("tab", { name: /month/i }));
    expect(await screen.findByText("Publish week")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish Roster" }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", weekStartDate: "2026-10-05" })));
  });
});
