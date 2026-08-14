import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), save: vi.fn(), activate: vi.fn(), archive: vi.fn(), duplicate: vi.fn(), review: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { tasksAdminData: mocks.data, saveTask: mocks.save, activateOperationTemplate: mocks.activate, archiveOperationTemplate: mocks.archive, duplicateTask: mocks.duplicate, reviewTask: mocks.review } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewOperationsAdminPage from "../CrewOperationsAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const fixture = { definitions: [{ id: "task-1", series_id: "series-1", name: "Opening Checklist", task_type: "checklist", schedule_type: "recurring", schedule_config: { frequency: "every_day" }, assignment_type: "all_crew", priority: "important", revision: 2, status: "active", blocks: [{ id: "block-1", block_type: "checklist_item", title: "Unlock entrance", is_required: true }] }], instances: [{ id: "instance-1", template_id: "task-1", name: "Opening Checklist", status: "in_progress" }], employees: [], published_sops: [], review_queue: [{ instance_id: "instance-2", employee_id: "employee-1", task_name: "Closing Check", employee_name: "QA Crew", business_date: "2026-08-14", status: "review_required" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.data.mockResolvedValue(fixture); mocks.save.mockResolvedValue("task-2"); mocks.activate.mockResolvedValue({}); mocks.archive.mockResolvedValue({}); mocks.duplicate.mockResolvedValue("task-copy"); mocks.review.mockResolvedValue({ status: "completed" }); });
afterEach(cleanup);

describe("Crew unified Tasks Admin", () => {
  it("renders one Tasks workspace with status filters and actions", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Tasks" })).not.toBeNull();
    expect(screen.getByText("Opening Checklist")).not.toBeNull();
    expect(screen.getByLabelText("Status")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Create Task/ })).not.toBeNull();
  });

  it("saves schedule, assignment and content through one Task authority", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create Task/ }));
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Closing Readiness" } });
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lock guest entrance" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ name: "Closing Readiness", schedule_type: "one_time", blocks: [expect.objectContaining({ title: "Lock guest entrance" })] })));
  });

  it("keeps manager-review finalization in the controlled review authority", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith("instance-2", "employee-1", "approved"));
  });
});
