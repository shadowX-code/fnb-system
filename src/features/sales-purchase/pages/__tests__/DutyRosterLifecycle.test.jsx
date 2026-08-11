import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  employees: vi.fn(), positions: vi.fn(), mappings: vi.fn(), templates: vi.fn(), allTemplates: vi.fn(), rosters: vi.fn(), period: vi.fn(), snapshot: vi.fn(), notify: vi.fn(),
}));

vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { listEmployees: mocks.employees } }));
vi.mock("../../../../services/jobPositionService.js", () => ({ jobPositionService: { listJobPositions: mocks.positions } }));
vi.mock("../../../../services/rosterPositionGroupService.js", () => ({ rosterPositionGroupService: { listMappings: mocks.mappings } }));
vi.mock("../../../../services/shiftTemplateService.js", () => ({ shiftTemplateService: { listShiftTemplates: mocks.templates, listAllShiftTemplates: mocks.allTemplates } }));
vi.mock("../../../../services/dutyRosterService.js", () => ({ dutyRosterService: { listDutyRosters: mocks.rosters, saveRosterWeekSnapshot: mocks.snapshot } }));
vi.mock("../../../../services/rosterPeriodService.js", () => ({ rosterPeriodService: { getOrCreateRosterPeriod: mocks.period } }));

import DutyRosterPage from "../DutyRosterPage.jsx";

const outlet = { id: "outlet-1", name: "Main Outlet", status: "active" };
const employee = { id: "employee-1", full_name: "Aina", nickname: "Aina", position: "Cook", department: "Kitchen", workplace: "outlet-1", employment_status: "active", is_active: true };
const template = { id: "template-1", outlet_id: "outlet-1", name: "Morning", code: "MORNING", start_time: "09:00", end_time: "17:00", break_minutes: 60, shift_type: "working", color: "green" };
const period = { id: "period-1", outlet_id: "outlet-1", week_start_date: "2026-08-10", week_end_date: "2026-08-16", status: "draft" };

beforeEach(() => {
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
  it("routes bulk assignment through one complete-week snapshot and prevents a duplicate submit while saving", async () => {
    let resolveSnapshot;
    mocks.snapshot.mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    const auth = { isProtectedRole: true, hasPermission: (key) => ["duty_roster.view", "duty_roster.create", "duty_roster.edit"].includes(key) };
    render(<DutyRosterPage store={{ outlets: [outlet] }} ui={{ notify: mocks.notify, confirm: vi.fn() }} auth={auth} />);
    const bulk = await screen.findByRole("button", { name: "Bulk" });
    fireEvent.click(bulk);
    const drawer = screen.getByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: /Morning/ }));
    const submit = within(drawer).getByRole("button", { name: /Assign 5 Dates/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1));
    expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1", rows: expect.arrayContaining([expect.objectContaining({ employee_id: "employee-1", shift_template_id: "template-1" })]) }));
    resolveSnapshot({ period, rows: [] });
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Bulk assignment saved" })));
  });
});
