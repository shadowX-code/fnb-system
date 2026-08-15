import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ attendance: vi.fn(), outlets: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { listAttendance: mocks.attendance } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: mocks.outlets } }));
import CrewAttendanceAdminPage from "../CrewAttendanceAdminPage.jsx";

const employee = (id, name, position = "Service Crew") => ({ id, full_name: name, nickname: name, position, workplace: "Friends Corner" });
const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const base = {
  outlet,
  status: "completed",
  clock_in_at: "2026-08-14T02:00:00.000Z",
  clock_out_at: "2026-08-14T10:00:00.000Z",
  clock_in_location_verified: true,
  clock_out_location_verified: true,
  clock_in_distance_meters: 12,
  clock_out_distance_meters: 14,
  clock_in_accuracy_meters: 8,
  clock_out_accuracy_meters: 9,
  roster_evidence_state: "completed",
  evidence_version: "roster-attendance-evidence-v1",
  schedule: { date: "2026-08-14", entry_type: "working", start_time: "10:00", end_time: "18:00", outlet_name: "Friends Corner", position: "Service Crew" },
  clock_in_variance_minutes: 0,
};
const row = (id, name, patch = {}) => ({ ...base, id, employee_id: `employee-${id}`, employee: employee(`employee-${id}`, name), ...patch });

const fixture = [
  row("verified", "Verified Crew"),
  row("open", "On Shift Crew", { status: "open", roster_evidence_state: "open", clock_out_at: null, clock_out_location_verified: false }),
  row("exception", "Exception Crew", { clock_in_location_verified: false, clock_in_location_exception: true, clock_in_exception_reason: "GPS unavailable" }),
  row("incomplete", "Incomplete Crew", { status: "incomplete", clock_out_at: null, clock_out_location_verified: false }),
  row("no-roster", "No Roster Crew", { schedule: null, roster_evidence_state: "no_roster", clock_in_variance_minutes: null }),
  row("off", "OFF Crew", { schedule: { date: "2026-08-14", entry_type: "off", outlet_name: "Friends Corner" }, roster_evidence_state: "not_required", clock_in_variance_minutes: null }),
  row("leave", "Leave Crew", { schedule: { date: "2026-08-14", entry_type: "annual_leave", source: "approved_leave", outlet_name: "Friends Corner" }, roster_evidence_state: "not_required", clock_in_variance_minutes: null }),
  row("late", "Late Crew", { clock_in_variance_minutes: 420 }),
  row("long", "Long Session Crew", { clock_in_at: "2026-08-12T02:00:00.000Z", clock_out_at: "2026-08-14T09:04:00.000Z" }),
  row("cross", "Cross Outlet Crew", { outlet: { id: "outlet-2", name: "Hola Hola" } }),
];

const ui = { notify: vi.fn() };

beforeEach(() => {
  mocks.attendance.mockReset().mockResolvedValue(fixture);
  mocks.outlets.mockReset().mockResolvedValue([outlet, { id: "outlet-2", name: "Hola Hola", is_active: true }]);
  ui.notify.mockReset();
});
afterEach(cleanup);

describe("Crew Attendance Admin", () => {
  it("separates attendance, location, roster, variance, and anomaly states", async () => {
    render(<CrewAttendanceAdminPage ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Attendance" })).not.toBeNull();
    expect(screen.getByText("Present Today")).not.toBeNull();
    expect(screen.getByText("Location Exceptions")).not.toBeNull();
    expect(screen.getByText("Incomplete Sessions")).not.toBeNull();
    expect(screen.getByText("On Shift")).not.toBeNull();
    expect(screen.getByText("Location Exception")).not.toBeNull();
    expect(screen.getByText("No Roster Match")).not.toBeNull();
    expect(screen.getByText("Late 7h")).not.toBeNull();
    expect(screen.getByText("Potential anomaly")).not.toBeNull();
    expect(screen.getAllByText("Attendance not required")).toHaveLength(2);
    expect(screen.getAllByText("Unexpected attendance")).toHaveLength(2);
    expect(screen.getByText("Worked at Hola Hola")).not.toBeNull();
  });

  it("uses the server-filtered date/outlet query and filters issue states", async () => {
    render(<CrewAttendanceAdminPage ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("Verified Crew");
    expect(mocks.attendance).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Attendance Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Location Exception" }));
    expect(screen.getByText("Exception Crew")).not.toBeNull();
    expect(screen.queryByText("Verified Crew")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Outlet" }));
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(mocks.attendance).toHaveBeenLastCalledWith(expect.objectContaining({ outletId: null })));
  });

  it("queries a new date range only after the picker is applied", async () => {
    render(<CrewAttendanceAdminPage ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("Verified Crew");
    mocks.attendance.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Date Range" }));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(mocks.attendance).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.attendance).toHaveBeenCalledTimes(1));
    expect(mocks.attendance).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String), outletId: "outlet-1" }));
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
  });

  it("opens an operational detail view for no-roster and exception evidence", async () => {
    render(<CrewAttendanceAdminPage ui={ui} store={{ outlets: [outlet] }} />);
    const noRoster = await screen.findByText("No Roster Crew");
    fireEvent.click(noRoster.closest("tr"));
    const dialog = screen.getByRole("dialog", { name: "Attendance Details" });
    expect(within(dialog).getByText("Attendance was recorded without a published roster for this date.")).not.toBeNull();
    expect(within(dialog).getByText("No Roster Match")).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("Exception Crew").closest("tr"));
    const exceptionDialog = screen.getByRole("dialog", { name: "Attendance Details" });
    expect(within(exceptionDialog).getByText("GPS unavailable")).not.toBeNull();
    expect(within(exceptionDialog).getAllByText("Distance from Outlet")).toHaveLength(2);
  });

  it("shows a clean empty state without manufacturing OFF or leave records", async () => {
    mocks.attendance.mockResolvedValueOnce([]);
    render(<CrewAttendanceAdminPage ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("No attendance records")).not.toBeNull();
    expect(screen.queryByText(/attendance record.*occurred on OFF/)).toBeNull();
  });
});
