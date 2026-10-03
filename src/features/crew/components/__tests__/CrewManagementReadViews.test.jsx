import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CrewManagementTasksMobile from "../CrewManagementTasksMobile.jsx";
import CrewManagementTodayTeam from "../CrewManagementTodayTeam.jsx";
import { crewService } from "../../../../services/crewService.js";
import i18n from "../../../../i18n/index.js";
vi.mock("../../hooks/useCrewTaskTitles.js", () => ({ default: (_token, tasks) => tasks }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { managementTaskDetail: vi.fn(), managementTodayTeam: vi.fn(), localizedContentForCrew: vi.fn().mockResolvedValue({}) } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const task = { id: "task", source: "instance", name: "Closing Duties", status: "completed", block_count: 1, completed_count: 1 };
const detail = { ...task, read_only: true, assignment: { kind: "outlet", label: "Outlet A" }, completion_contributors: [{ employee_name: "Lee" }], blocks: [{ id: "item", title: "Floor", block_type: "checklist_item", status: "completed", note: "Recorded evidence", response_actor: { employee_name: "Lee" } }] };
const team = { outlet_id: "a", outlet_name: "Outlet A", as_of: "2026-10-02T08:30:00+08:00", summary: { scheduled: 4, clocked_in: 1, not_clocked_in: 2, completed: 1 }, employees: ["clocked_in", "not_clocked_in", "upcoming", "completed"].map((state, index) => ({ employee_id: String(index), employee_name: `Crew ${index}`, state, shift: { start_time: "08:00", end_time: "17:00" }, clock_in_at: "2026-10-02T08:03:00+08:00", clock_out_at: "2026-10-02T17:00:00+08:00" })) };
async function settle() { await act(async () => {}); }
describe("Management scoped read views", () => {
  it("opens real Task evidence in readonly mode without execution or Reset controls", async () => {
    await i18n.changeLanguage("en"); crewService.managementTaskDetail.mockResolvedValue(detail);
    render(<CrewManagementTasksMobile token="session" outletId="a" data={{ tasks: [task] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Closing Duties/ })); await settle();
    expect(crewService.managementTaskDetail).toHaveBeenCalledWith("session", "a", "task", "instance");
    expect(screen.getByText("Recorded evidence")).toBeTruthy();
    expect(screen.getAllByText("Lee").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Redo|Reset|Complete|Done/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("does not accept detail from a previous outlet after a context change", async () => {
    let resolveOld;
    crewService.managementTaskDetail.mockImplementationOnce(() => new Promise((resolve) => { resolveOld=resolve; })).mockResolvedValueOnce({ ...detail, name: "Outlet B Task" });
    const view=render(<CrewManagementTasksMobile token="session" outletId="a" data={{ tasks: [task] }} initialTarget={{ row: task }} />);
    await settle(); view.rerender(<CrewManagementTasksMobile token="session" outletId="b" data={{ tasks: [] }} initialTarget={{ row: task }} />); await settle();
    await act(async () => { resolveOld(detail); });
    expect(screen.getByRole("heading", { name: "Outlet B Task" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Closing Duties" })).toBeNull();
  });
  it("shows safe retry feedback for a denied detail read", async () => {
    crewService.managementTaskDetail.mockRejectedValue(new Error("Denied"));
    render(<CrewManagementTasksMobile token="session" outletId="a" data={{ tasks: [] }} initialTarget={{ row: task }} />); await settle();
    expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Recorded evidence")).toBeNull();
  });
  it("renders the four canonical team states and real attendance times", async () => {
    crewService.managementTodayTeam.mockResolvedValue(team);
    render(<CrewManagementTodayTeam token="session" outletId="a" full />); await settle();
    expect(screen.getByText("Clocked In 08:03 am")).toBeTruthy();
    expect(screen.getByText("Completed 05:00 pm")).toBeTruthy();
    expect(screen.getAllByText("Upcoming").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not Clocked In").length).toBeGreaterThan(0);
  });
  it("clears old outlet team data while loading and refreshes visible snapshots", async () => {
    vi.useFakeTimers(); crewService.managementTodayTeam.mockResolvedValueOnce(team).mockResolvedValue({ ...team, outlet_name: "Outlet B", employees: [] });
    const view=render(<CrewManagementTodayTeam token="session" outletId="a" full />); await settle();
    view.rerender(<CrewManagementTodayTeam token="session" outletId="b" full />);
    expect(screen.queryByText(/Outlet A/)).toBeNull(); await settle();
    expect(screen.getByText(/Outlet B/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(crewService.managementTodayTeam).toHaveBeenLastCalledWith("session", "b");
    expect(crewService.managementTodayTeam.mock.calls.length).toBe(3);
  });
});
