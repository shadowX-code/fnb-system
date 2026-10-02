import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CrewOperationsMobile from "../CrewOperationsMobile.jsx";
import { crewService } from "../../../../services/crewService.js";
import i18n from "../../../../i18n/index.js";
vi.mock("../../hooks/useCrewTaskTitles.js", () => ({ default: (_token, tasks) => tasks }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { operationsAllTasks: vi.fn(), operationsHistory: vi.fn(), operationDetail: vi.fn(), localizedContentForCrew: vi.fn().mockResolvedValue({}) } }));
const run = { id: "run", name: "Closing Duties", source: "instance", schedule_type: "recurring", business_date: "2026-10-02", status: "not_started", completed_count: 0, block_count: 12, available_from: "2026-10-02T20:30:00+08:00", due_at: "2026-10-02T22:30:00+08:00" };
beforeEach(async () => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T20:29:59+08:00")); await i18n.changeLanguage("en"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
async function mount(task = run) {
  crewService.operationsAllTasks.mockResolvedValue({ tasks: [task] });
  crewService.operationsHistory.mockResolvedValue({ tasks: [task] });
  const view = render(<CrewOperationsMobile token="test" data={{ tasks: [task] }} />);
  await act(async () => {});
  return view;
}
describe("Crew Task views share presentation states", () => {
  it("updates a stationary Active list at start and due boundaries without changing lifecycle", async () => {
    await mount();
    const row = screen.getByRole("button", { name: /Closing Duties/ });
    expect(within(row).getByText("Upcoming")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1001); });
    expect(within(screen.getByRole("button", { name: /Closing Duties/ })).getByText("Start Now")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(7200000); });
    expect(within(screen.getByRole("button", { name: /Closing Duties/ })).getByText("Overdue")).toBeTruthy();
    expect(run.status).toBe("not_started");
  });
  it("shows Overdue with 3/12 in History and Detail and filters by the same derived state", async () => {
    vi.setSystemTime(new Date("2026-10-02T23:00:00+08:00"));
    const task = { ...run, status: "in_progress", completed_count: 3 };
    crewService.operationDetail.mockResolvedValue({ ...task, due_at: undefined, available_until: run.due_at, blocks: Array.from({ length: 12 }, (_, i) => ({ id: `item${i}`, block_type: "checklist_item", title: `Item ${i}`, status: i < 3 ? "completed" : "pending" })) });
    await mount(task);
    fireEvent.click(screen.getByRole("tab", { name: "History", exact: true }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("tab", { name: "Overdue", exact: true }));
    const row = screen.getByRole("button", { name: /Closing Duties/ });
    expect(row.textContent).toContain("3 of 12");
    expect(within(row).getAllByText(/Overdue/).length).toBeGreaterThan(0);
    fireEvent.click(row); await act(async () => {});
    const summary = screen.getByRole("region", { name: "Task summary" });
    expect(summary.textContent).toContain("Overdue");
    expect(summary.textContent).toContain("3 of 12");
  });
});
