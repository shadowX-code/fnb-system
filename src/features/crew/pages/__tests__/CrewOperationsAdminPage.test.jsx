import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), save: vi.fn(), ensure: vi.fn(), activate: vi.fn(), duplicate: vi.fn(), review: vi.fn(), manage: vi.fn(), detail: vi.fn(), result: vi.fn(), localization: vi.fn(), saveLocalization: vi.fn(), translate: vi.fn(), editTranslation: vi.fn(), reviewTranslation: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { tasksAdminData: mocks.data, saveTask: mocks.save, ensureTaskDraft: mocks.ensure, activateOperationTemplate: mocks.activate, duplicateTask: mocks.duplicate, reviewTask: mocks.review, manageTaskSchedule: mocks.manage, taskAdminDetail: mocks.detail, taskAdminResult: mocks.result, localizedContentAdmin: mocks.localization, saveLocalizedContentUnits: mocks.saveLocalization, translateLocalizedContent: mocks.translate, editLocalizedTranslation: mocks.editTranslation, reviewLocalizedTranslation: mocks.reviewTranslation } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewOperationsAdminPage from "../CrewOperationsAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const fixture = { definitions: [{ id: "task-1", series_id: "series-1", name: "Opening Checklist", task_type: "checklist", schedule_type: "recurring", schedule_config: { frequency: "every_day" }, assignment_type: "all_crew", completion_rule: "one_for_team", priority: "important", revision: 2, status: "active", has_draft: false, current_version: { id: "task-1", revision: 2, status: "active" }, draft_version: null, created_date: "2026-08-01", next_run: { state: "scheduled", date: "2026-08-15", at: "2026-08-15T01:30:00Z" }, blocks: [{ id: "block-1", block_type: "checklist_item", title: "Unlock entrance", is_required: true }] }], instances: [{ id: "instance-1", template_id: "task-1", name: "Opening Checklist", status: "in_progress" }], employees: [], published_sops: [], review_queue: [{ instance_id: "instance-2", employee_id: "employee-1", task_name: "Closing Check", employee_name: "QA Crew", business_date: "2026-08-14", status: "review_required" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
beforeEach(() => { Object.values(mocks).forEach((mock) => mock.mockReset()); mocks.data.mockResolvedValue(fixture); mocks.save.mockResolvedValue("task-2"); mocks.saveLocalization.mockResolvedValue({ units: {} }); mocks.localization.mockResolvedValue({ units: {} }); mocks.ensure.mockResolvedValue({ id: "task-draft", revision: 3, status: "draft", created: true }); mocks.activate.mockResolvedValue({}); mocks.duplicate.mockResolvedValue("task-copy"); mocks.review.mockResolvedValue({ status: "completed" }); mocks.manage.mockResolvedValue({ status: "paused" }); mocks.detail.mockResolvedValue({ definition: { ...fixture.definitions[0], block_count: 1 }, draft: { ...fixture.definitions[0], id: "task-draft", revision: 3, status: "draft", blocks: fixture.definitions[0].blocks }, progress: { instances: 1, in_progress: 1 }, history: [{ instance_id: "instance-1", date: "2026-08-14", revision: 2, status: "in_progress", actors: [], has_result: true }], versions: [{ id: "task-draft", revision: 3, status: "draft", block_count: 1, instance_count: 0, updated_at: "2026-08-15" }, { id: "task-1", revision: 2, status: "active", block_count: 1, instance_count: 1, updated_at: "2026-08-14" }] }); mocks.result.mockResolvedValue({ instance: { business_date: "2026-08-14", template_revision: 2 }, status: "in_progress", assignees: [{ employee_id: "employee-1", employee_name: "QA Crew", status: "in_progress" }], blocks: [] }); });
afterEach(cleanup);

describe("Crew unified Tasks Admin", () => {
  it("renders one Tasks workspace with status filters and actions", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Tasks" })).not.toBeNull();
    expect(screen.getByText("Opening Checklist")).not.toBeNull();
    expect(screen.getByLabelText("Status")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Create Task/ })).not.toBeNull();
    expect(screen.getByText("Daily")).not.toBeNull();
    expect(screen.getByText("Important")).not.toBeNull();
    expect(screen.getByText("15/08/2026")).not.toBeNull();
    expect(screen.getByText("9:30 am")).not.toBeNull();
    expect(screen.getByRole("button", { name: "View Opening Checklist" })).not.toBeNull();
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
    expect(within(screen.getByRole("dialog", { name: "Temperature Check" })).getByText("Record chiller temperature")).not.toBeNull();
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
    mocks.data.mockResolvedValue({ ...fixture, definitions: [{ ...fixture.definitions[0], blocks }] });
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    mocks.detail.mockResolvedValueOnce({ definition: { ...fixture.definitions[0], block_count: 16 }, draft: { ...fixture.definitions[0], id: "task-draft", revision: 3, status: "draft", blocks }, progress: {}, history: [], versions: [] });
    fireEvent.click(await screen.findByRole("button", { name: "New Revision" }));
    await screen.findByRole("heading", { name: /Create New Revision/ });
    expect(screen.getAllByLabelText(/More actions for block/)).toHaveLength(16);
    expect(screen.getByText("16 blocks · order freezes into each daily instance")).not.toBeNull();
  });

  it("labels active content as a new immutable revision", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Revision" }));
    expect(await screen.findByRole("heading", { name: /Create New Revision/ })).not.toBeNull();
    expect(screen.getByText(/existing task instances remain frozen/i)).not.toBeNull();
    expect(mocks.ensure).toHaveBeenCalledWith("task-1");
  });

  it("reuses the existing Draft instead of creating another revision", async () => {
    const currentWithDraft = { ...fixture.definitions[0], has_draft: true, draft_version: { id: "task-draft", revision: 3, status: "draft" } };
    mocks.data.mockResolvedValue({ ...fixture, definitions: [currentWithDraft] });
    mocks.ensure.mockResolvedValue({ id: "task-draft", revision: 3, status: "draft", created: false });
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue Draft" }));
    expect(await screen.findByRole("heading", { name: /Continue Draft/ })).not.toBeNull();
    expect(mocks.ensure).toHaveBeenCalledWith("task-draft");
  });

  it("separates definition lifecycle from execution progress and exposes history", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "View Opening Checklist" }));
    expect(await screen.findByText("01/08/2026")).not.toBeNull();
    expect(screen.getAllByText("15/08/2026").length).toBeGreaterThan(0);
    expect(await screen.findByText("Execution Progress")).not.toBeNull();
    expect(screen.getByText("Task Content")).not.toBeNull();
    expect(screen.getByText("Unlock entrance")).not.toBeNull();
    expect(screen.getByText("Checklist Item")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Executions" }));
    expect(screen.getByText("Execution History")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Result" }));
    await waitFor(() => expect(mocks.result).toHaveBeenCalledWith("instance-1"));
  });

  it("shows canonical version history and result views", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "View Opening Checklist" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Versions" }));
    expect(screen.getByText("Version History")).not.toBeNull();
    expect(screen.getByText("Editable Draft")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Executions" }));
    fireEvent.click(screen.getByRole("button", { name: "View Result" }));
    expect(await screen.findByRole("tab", { name: "By Task Item" })).not.toBeNull();
    expect(screen.getByRole("tab", { name: "By Crew" })).not.toBeNull();
  });

  it("routes pause and end-date changes through the controlled lifecycle authority", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "More actions for Opening Checklist" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage Schedule" }));
    fireEvent.click(screen.getByRole("button", { name: /Pause future/ }));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith("task-1", "pause", null));
  });

  it("keeps manager-review finalization in the controlled review authority", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith("instance-2", "employee-1", "approved"));
  });

  it("updates the inline Mobile Preview live without saving the Task", async () => {
    render(<CrewOperationsAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Task" }));
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Live preview checklist" } });
    expect(screen.getByText("Mobile Preview")).not.toBeNull();
    expect(screen.getAllByText("Live preview checklist").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Live preview checklistChecklist itemPending/ }));
    fireEvent.click(screen.getByRole("button", { name: /Complete Live preview checklist/ }));
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
