import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), save: vi.fn(), activate: vi.fn(), archive: vi.fn(), duplicate: vi.fn(), review: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { tasksAdminData: mocks.data, saveTask: mocks.save, activateOperationTemplate: mocks.activate, archiveOperationTemplate: mocks.archive, duplicateTask: mocks.duplicate, reviewTask: mocks.review } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewOperationsAdminPage from "../CrewOperationsAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const fixture = { definitions: [{ id: "task-1", series_id: "series-1", name: "Opening Checklist", task_type: "checklist", schedule_type: "recurring", schedule_config: { frequency: "every_day" }, assignment_type: "all_crew", priority: "important", revision: 2, status: "active", blocks: [{ id: "block-1", block_type: "checklist_item", title: "Unlock entrance", is_required: true }] }], instances: [{ id: "instance-1", template_id: "task-1", name: "Opening Checklist", status: "in_progress" }], employees: [], published_sops: [], review_queue: [{ instance_id: "instance-2", employee_id: "employee-1", task_name: "Closing Check", employee_name: "QA Crew", business_date: "2026-08-14", status: "review_required" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
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
    fireEvent.change(screen.getByLabelText(/Task Name/), { target: { value: "Closing Readiness" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lock guest entrance" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith("outlet-1", expect.objectContaining({ name: "Closing Readiness", schedule_type: "one_time", blocks: [expect.objectContaining({ title: "Lock guest entrance" })] })));
  });

  it("uses one scrolling builder instead of engineering tabs", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create Task/ }));
    expect(screen.getByRole("heading", { name: "Basic information" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Schedule" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Assignment" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Task content" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Completion" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Completion & Evidence" })).toBeNull();
  });

  it("keeps unsaved content in the Crew preview and offers grouped blocks", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create Task/ }));
    fireEvent.change(screen.getByLabelText(/Task Name/), { target: { value: "Temperature Check" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Record chiller temperature" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview as Crew" }));
    expect(screen.getByRole("dialog", { name: "Temperature Check" })).not.toBeNull();
    expect(screen.getByText("Record chiller temperature")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to Editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Block" }));
    const picker = screen.getByRole("dialog", { name: "Add content block" });
    expect(picker.textContent).toContain("Action");
    expect(picker.textContent).toContain("Information");
    expect(picker.textContent).toContain("Input");
    expect(screen.getByRole("button", { name: /Image/ }).disabled).toBe(true);
  });

  it("uses progressive schedule and assignment controls", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Create Task/ }));
    const builder = screen.getByRole("dialog", { name: "Create Task" });
    fireEvent.click(within(builder).getByRole("button", { name: /Recurring/ }));
    expect(within(builder).getByText("Repeats")).not.toBeNull();
    fireEvent.click(within(builder).getByRole("button", { name: /Shift-based/ }));
    expect(within(builder).getByText("Trigger")).not.toBeNull();
    fireEvent.click(within(builder).getByRole("button", { name: "Position" }));
    expect(within(builder).getByText("Service Crew")).not.toBeNull();
    expect(within(builder).getByText("Only Crew scheduled to work that day")).not.toBeNull();
  });

  it("keeps a 16-block checklist compact and revision-safe", async () => {
    const blocks = Array.from({ length: 16 }, (_, index) => ({ id: `block-${index}`, block_type: "checklist_item", title: `Checklist item ${index + 1}`, is_required: true }));
    mocks.data.mockResolvedValue({ ...fixture, definitions: [{ ...fixture.definitions[0], status: "draft", blocks }] });
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getAllByLabelText(/More actions for block/)).toHaveLength(16);
    expect(screen.getByText("16 blocks · order freezes into each daily instance")).not.toBeNull();
  });

  it("labels active content as a new immutable revision", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Revision" }));
    expect(screen.getByRole("heading", { name: /Create New Revision/ })).not.toBeNull();
    expect(screen.getByText(/active version remains unchanged/i)).not.toBeNull();
  });

  it("keeps manager-review finalization in the controlled review authority", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith("instance-2", "employee-1", "approved"));
  });
});
