import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), detail: vi.fn(), save: vi.fn(), activate: vi.fn(), archive: vi.fn(), task: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { operationsAdminData: mocks.data, operationAdminDetail: mocks.detail, saveOperationTemplate: mocks.save, activateOperationTemplate: mocks.activate, archiveOperationTemplate: mocks.archive, saveDailyOperationTask: mocks.task } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewOperationsAdminPage from "../CrewOperationsAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const fixture = { date: "2026-08-13", summary: { total: 2, completed: 1, in_progress: 1, overdue: 0, needs_attention: 1, with_exceptions: 0 }, templates: [{ id: "template-1", series_id: "series-1", name: "Opening Checklist", operation_type: "opening", revision: 1, status: "active", applicable_positions: [], items: [{ id: "item-1", title: "Unlock entrance", is_required: true, evidence_requirement: "none" }] }], instances: [{ id: "instance-1", name: "Opening Checklist", operation_type: "opening", template_revision: 1, status: "in_progress", available_from: "2026-08-13T06:00:00+08:00", available_until: "2026-08-13T11:00:00+08:00" }], daily_tasks: [{ id: "task-1", title: "Check reservation board", priority: "normal", status: "pending" }], activity: [{ item_id: "action-1", checklist: "Opening Checklist", item: "Coffee machine", status: "needs_attention", note: "Needs service", employee: "Alex Tan" }], published_sops: [] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.data.mockResolvedValue(fixture); mocks.detail.mockResolvedValue({ instance: fixture.instances[0], items: [] }); mocks.save.mockResolvedValue("template-2"); mocks.activate.mockResolvedValue({}); mocks.archive.mockResolvedValue({}); mocks.task.mockResolvedValue("task-2"); });
afterEach(cleanup);

describe("Crew Daily Operations Admin", () => {
  it("renders server-derived status, exceptions and Daily Tasks", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Daily Operations" })).not.toBeNull();
    expect(screen.getAllByText("Opening Checklist").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs service")).not.toBeNull();
    expect(screen.getByText("Check reservation board")).not.toBeNull();
  });

  it("saves a complete Draft template through one authority", async () => {
    render(<CrewOperationsAdminPage initialTab="templates" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: /New Template/ }));
    fireEvent.change(screen.getByLabelText("Template Name"), { target: { value: "Closing Checklist" } });
    fireEvent.change(screen.getByLabelText("Item Title"), { target: { value: "Lock guest entrance" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ name: "Closing Checklist", items: [expect.objectContaining({ title: "Lock guest entrance" })] })));
  });
});
