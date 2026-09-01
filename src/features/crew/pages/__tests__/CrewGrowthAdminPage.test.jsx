import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), evidence: vi.fn(), save: vi.fn(), assess: vi.fn(), certify: vi.fn(), positions: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { growthAdminData: mocks.data, growthAdminEvidence: mocks.evidence, saveGrowthSkill: mocks.save, submitGrowthAssessment: mocks.assess, certifyGrowthSkill: mocks.certify } }));
vi.mock("../../../../services/jobPositionService.js", () => ({ jobPositionService: { listJobPositions: mocks.positions } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewGrowthAdminPage from "../CrewGrowthAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const skill = { id: "skill-1", outlet_id: outlet.id, name: "Customer Greeting", category: "Service", description: "Guest welcome", status: "active", certification_method: "learning_and_review", validity_months: null, requirements_version: 1, positions: ["Service Crew"], outlets: [outlet.id], requirements: [{ id: "req-1", type: "practical", label: "Manager Practical Assessment", required: true, config: {}, sort_order: 1 }] };
const state = { employee_id: "employee-1", skill_id: skill.id, status: "ready_for_review", applicable: true, requirements_completed: 0, requirements_total: 1, certification: null, requirements: [{ requirement_id: "req-1", type: "practical", label: "Manager Practical Assessment", required: true, completed: false, detail: "Manager practical review pending", config: {} }] };
const fixture = { skills: [skill], crew: [{ employee: { id: "employee-1", full_name: "Alex Tan", employee_code: "QA-01", position: "Service Crew" }, skills: [state] }], reviews: [{ employee_id: "employee-1", employee_name: "Alex Tan", position: "Service Crew", skill_id: skill.id, skill_name: skill.name, state }], recent_certifications: [] };
const auth = { hasPermission: () => true };
const ui = { notify: vi.fn(), navigate: vi.fn() };

beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.evidence.mockReset().mockResolvedValue([{ type: "module", id: "module-1", label: "Service Basics · Greeting" }, { type: "lesson", id: "lesson-1", label: "Guest flow lesson" }, { type: "sop", id: "sop-1", label: "Welcome & Goodbye Standard · v1" }, { type: "quiz", id: "quiz-1", label: "Guest experience check" }]); mocks.save.mockReset().mockResolvedValue("skill-1"); mocks.assess.mockReset().mockResolvedValue("assessment-1"); mocks.certify.mockReset().mockResolvedValue("cert-1"); mocks.positions.mockReset().mockResolvedValue([{ id: "position-1", name: "Service Crew", status: "active" }, { id: "position-2", name: "Cashier", status: "active" }]); ui.notify.mockReset(); ui.navigate.mockReset(); });
afterEach(cleanup);

describe("Crew Growth Admin", () => {
  it("shows authoritative overview metrics, coverage and attention queue", async () => {
    render(<CrewGrowthAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Growth Overview" })).not.toBeNull();
    expect(screen.getAllByText("Customer Greeting").length).toBeGreaterThan(0);
    expect(screen.getByText("Certified Crew")).not.toBeNull();
    expect(screen.getByText("Crew Growth")).not.toBeNull();
    expect(screen.getAllByText("Alex Tan").length).toBeGreaterThan(0);
    expect(screen.getByText("Needs Review")).not.toBeNull();
    expect(screen.getByText("1 certification review ready")).not.toBeNull();
    expect(mocks.evidence).not.toHaveBeenCalled();
  });

  it("separates a read failure from an empty Growth state", async () => {
    mocks.data.mockRejectedValueOnce(new Error("Request timed out"));
    render(<CrewGrowthAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load Growth");
    expect(screen.getByText("Request timed out")).not.toBeNull();
    mocks.data.mockResolvedValueOnce(fixture);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Crew Growth" })).not.toBeNull();
  });

  it("filters the merged Crew table and clears no-results state", async () => {
    render(<CrewGrowthAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    const search = await screen.findByPlaceholderText("Search by name or employee code");
    fireEvent.change(search, { target: { value: "Nobody" } });
    expect(screen.getByText("No Crew match these filters")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getAllByText("Alex Tan").length).toBeGreaterThan(0);
  });

  it("opens the integrated review workflow from Growth Overview", async () => {
    render(<CrewGrowthAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByRole("heading", { name: "Growth Overview" });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("dialog", { name: "Practical Assessment" })).not.toBeNull();
  });

  it("renders Skills filters and opens the requirement editor", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByRole("heading", { name: "Skills" });
    expect(mocks.evidence).toHaveBeenCalledWith("outlet-1");
    fireEvent.click(screen.getByRole("button", { name: "View / Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit Skill" })).not.toBeNull();
    expect(screen.getByText("Certification Requirements")).not.toBeNull();
    expect(screen.getByText("Changes create a new requirements version. Existing certification evidence is preserved.")).not.toBeNull();
    expect(screen.getByText("Manager practical assessment")).not.toBeNull();
  });

  it("creates a skill through the controlled save authority", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.change(screen.getByLabelText("Skill Name"), { target: { value: "Taking Orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Skill" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: "Taking Orders", outlet_id: "outlet-1" })));
  });

  it("validates structured expiry months before saving", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.change(screen.getByLabelText("Skill Name"), { target: { value: "Taking Orders" } });
    fireEvent.click(screen.getByRole("button", { name: "No Expiry" }));
    fireEvent.click(screen.getByRole("button", { name: "Expires after X months" }));
    expect(screen.getByRole("button", { name: "Save Skill" }).disabled).toBe(true);
    expect(screen.getByText("Expiry must be 1 to 120 months.")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Expiry Months"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Skill" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ validity_months: "12" })));
  });

  it("uses the canonical Applicable Positions multi-select and retains its selections on save", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.change(screen.getByLabelText("Skill Name"), { target: { value: "Taking Orders" } });
    fireEvent.click(screen.getByRole("button", { name: "All active Crew" }));
    fireEvent.click(screen.getByRole("button", { name: "Cashier" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Skill" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ positions: ["Cashier"] })));
  });

  it("adds a supported practical requirement into the shared builder with structured checklist rows", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.change(screen.getByLabelText("Skill Name"), { target: { value: "Taking Orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Requirement" }));
    expect(screen.getByRole("group", { name: "Requirement type" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manager practical assessment" }));
    expect(screen.getByLabelText("Assessment Name")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add checklist item" }));
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Confirms the order clearly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Skill" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ requirements: [expect.objectContaining({ type: "practical", config: { items: ["Confirms the order clearly"] } })] })));
    expect(mocks.save.mock.calls.at(-1)[0].requirements[0].editor_key).toBeUndefined();
  });

  it("lists every canonical requirement type supported by the selected certification method", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Requirement" }));
    for (const label of ["Complete onboarding module", "Complete lesson", "Read / acknowledge SOP", "Pass knowledge check", "Manager practical assessment"]) expect(screen.getByRole("button", { name: label })).not.toBeNull();
  });

  it("keeps requirement ordering and actions inside the compact expanded builder", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.change(screen.getByLabelText("Skill Name"), { target: { value: "Taking Orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Requirement" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete onboarding module" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Requirement" }));
    fireEvent.click(screen.getByRole("button", { name: "Read / acknowledge SOP" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for requirement 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Up" }));
    expect(screen.getAllByText("Read / acknowledge SOP").at(0).closest("article")?.textContent).toContain("01");
  });

  it("removes a requirement through its compact action menu", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Requirement" }));
    fireEvent.click(screen.getByRole("button", { name: "Manager practical assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "More actions for requirement 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("No requirements yet")).not.toBeNull();
  });

  it("shows employee skill profile without client-side status derivation", async () => {
    render(<CrewGrowthAdminPage initialTab="crew" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "View Alex Tan growth" }));
    expect(screen.getByRole("dialog", { name: "Crew Growth Profile" })).not.toBeNull();
    expect(screen.getAllByText("Ready for Review").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Customer Greeting.*Ready for Review/ }));
    expect(screen.queryByRole("dialog", { name: "Crew Growth Profile" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Practical Assessment" })).not.toBeNull();
  });

  it("records practical assessment from the review queue", async () => {
    render(<CrewGrowthAdminPage initialTab="reviews" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit Assessment" }));
    await waitFor(() => expect(mocks.assess).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "employee-1", skillId: "skill-1", result: "pass" })));
  });
});
