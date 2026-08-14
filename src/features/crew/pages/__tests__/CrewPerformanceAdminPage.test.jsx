import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), review: vi.fn(), finalize: vi.fn(), moderate: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { performanceAdminData: mocks.data, submitPerformanceReview: mocks.review, finalizePerformance: mocks.finalize, moderateFeedback: mocks.moderate } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewPerformanceAdminPage from "../CrewPerformanceAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const row = { employee: { id: "employee-1", full_name: "Alex Tan", employee_code: "QA-01", position: "Service Crew" }, result: { id: "result-1", period_start: "2026-08-01", status: "review_required", total_score: 82, attendance_score: 28, service_score: 25, customer_score: 12, knowledge_score: 13, conduct_score: 4, calculation_version: "performance-v1", components: { attendance: { max_score: 30 }, service: { status: "reviewed", score: 25, max_score: 30 }, customer: { max_score: 15 }, knowledge: { max_score: 15 }, conduct: { status: "review_required", max_score: 10 } } } };
const attentionRow = { employee: { id: "employee-2", full_name: "Mina Lee", employee_code: "QA-02", position: "Kitchen Crew" }, result: { id: "result-2", period_start: "2026-08-01", status: "finalized", total_score: 60, attendance_score: 26, service_score: 18, customer_score: 8, knowledge_score: 0, conduct_score: 8, calculation_version: "performance-v1", components: { attendance: { max_score: 30 }, service: { status: "reviewed", score: 18, max_score: 30 }, customer: { max_score: 15 }, knowledge: { max_score: 15 }, conduct: { status: "reviewed", score: 8, max_score: 10 } } } };
const fixture = { summary: { average_score: 71, crew_reviewed: 1, awaiting_review: 1, needs_attention: 1 }, crew: [row, attentionRow], reviews: [], feedback: [{ id: "feedback-1", submitted_at: "2026-08-12", employee_id: "employee-1", employee_name: "Alex Tan", experience: "great", positive_tags: ["Friendly"], improvement_tags: [], comment: "Great service", scoring_status: "included" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };
beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.review.mockReset().mockResolvedValue({}); mocks.finalize.mockReset().mockResolvedValue({}); mocks.moderate.mockReset().mockResolvedValue({}); });
afterEach(cleanup);

describe("Crew Performance Admin", () => {
  it("renders the server-derived overview and detail evidence", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Performance Overview" })).not.toBeNull();
    fireEvent.click(screen.getAllByText("Alex Tan").at(-1));
    expect(screen.getByRole("dialog", { name: /Alex Tan · Performance/ })).not.toBeNull();
    expect(screen.getAllByText("82").length).toBeGreaterThan(0);
  });

  it("groups Service and Conduct into one employee Review Queue row and submits through the controlled authority", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findAllByText("Alex Tan")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row").filter((entry) => entry.textContent.includes("Alex Tan") && entry.textContent.includes("Service Standards") === false).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Meets Standard" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Submit Review" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "employee-1", component: "conduct" })));
  });

  it("filters real Crew rows and surfaces KPI, attention, and framework evidence", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("71 / 100")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Review Queue" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Needs Attention" })).not.toBeNull();
    expect(screen.getByText("Performance Framework · 100 pts")).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Name or employee code"), { target: { value: "Mina" } });
    expect(screen.queryAllByText("Alex Tan").length).toBe(0);
    expect(screen.getAllByText("Mina Lee").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(screen.getAllByText("Alex Tan").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText("Name or employee code"), { target: { value: "Nobody matches" } });
    expect(screen.getByText("No reviews match these filters")).not.toBeNull();
    expect(screen.getByText("No Crew match these filters")).not.toBeNull();
  });

  it("keeps unfavorable feedback and records an audited exclusion", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exclude" }));
    fireEvent.change(screen.getByPlaceholderText(/Explain why/), { target: { value: "Duplicate guest submission" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Exclude" }).at(-1));
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith("feedback-1", true, "Duplicate guest submission"));
  });
});
