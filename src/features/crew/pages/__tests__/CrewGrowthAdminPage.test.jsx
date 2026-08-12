import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), save: vi.fn(), assess: vi.fn(), certify: vi.fn(), journeys: vi.fn(), sops: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { growthAdminData: mocks.data, saveGrowthSkill: mocks.save, submitGrowthAssessment: mocks.assess, certifyGrowthSkill: mocks.certify, listOnboardingAdmin: mocks.journeys, listOutletSopsAdmin: mocks.sops } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewGrowthAdminPage from "../CrewGrowthAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const skill = { id: "skill-1", outlet_id: outlet.id, name: "Customer Greeting", category: "Service", description: "Guest welcome", status: "active", certification_method: "learning_and_review", validity_months: null, requirements_version: 1, positions: ["Service Crew"], outlets: [outlet.id], requirements: [{ id: "req-1", type: "practical", label: "Manager Practical Assessment", required: true, config: {}, sort_order: 1 }] };
const state = { employee_id: "employee-1", skill_id: skill.id, status: "ready_for_review", applicable: true, requirements_completed: 0, requirements_total: 1, certification: null, requirements: [{ requirement_id: "req-1", type: "practical", label: "Manager Practical Assessment", required: true, completed: false, detail: "Manager practical review pending", config: {} }] };
const fixture = { skills: [skill], crew: [{ employee: { id: "employee-1", full_name: "Alex Tan", employee_code: "QA-01", position: "Service Crew" }, skills: [state] }], reviews: [{ employee_id: "employee-1", employee_name: "Alex Tan", position: "Service Crew", skill_id: skill.id, skill_name: skill.name, state }], recent_certifications: [] };
const auth = { hasPermission: () => true };
const ui = { notify: vi.fn() };

beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.save.mockReset().mockResolvedValue("skill-1"); mocks.assess.mockReset().mockResolvedValue("assessment-1"); mocks.certify.mockReset().mockResolvedValue("cert-1"); mocks.journeys.mockReset().mockResolvedValue([]); mocks.sops.mockReset().mockResolvedValue({ sops: [] }); ui.notify.mockReset(); });
afterEach(cleanup);

describe("Crew Growth Admin", () => {
  it("shows authoritative overview metrics, coverage and attention queue", async () => {
    render(<CrewGrowthAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Growth Overview" })).not.toBeNull();
    expect(screen.getAllByText("Customer Greeting").length).toBeGreaterThan(0);
    expect(screen.getByText("Assessment pending")).not.toBeNull();
    expect(mocks.journeys).not.toHaveBeenCalled();
    expect(mocks.sops).not.toHaveBeenCalled();
  });

  it("renders Skills filters and opens the requirement editor", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByRole("heading", { name: "Skills" });
    expect(mocks.journeys).toHaveBeenCalledWith("outlet-1");
    expect(mocks.sops).toHaveBeenCalledWith("outlet-1");
    fireEvent.click(screen.getByRole("button", { name: "View / Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit Skill" })).not.toBeNull();
    expect(screen.getByText("Certification Requirements")).not.toBeNull();
  });

  it("creates a skill through the controlled save authority", async () => {
    render(<CrewGrowthAdminPage initialTab="skills" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.change(screen.getByLabelText("Skill Name"), { target: { value: "Taking Orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Skill" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: "Taking Orders", outlet_id: "outlet-1" })));
  });

  it("shows employee skill profile without client-side status derivation", async () => {
    render(<CrewGrowthAdminPage initialTab="crew" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByText("Alex Tan"));
    expect(screen.getByRole("dialog", { name: "Alex Tan" })).not.toBeNull();
    expect(screen.getAllByText("Ready for Review").length).toBeGreaterThan(0);
  });

  it("records practical assessment from the review queue", async () => {
    render(<CrewGrowthAdminPage initialTab="reviews" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Pass Assessment" }));
    await waitFor(() => expect(mocks.assess).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "employee-1", skillId: "skill-1", result: "pass" })));
  });
});
