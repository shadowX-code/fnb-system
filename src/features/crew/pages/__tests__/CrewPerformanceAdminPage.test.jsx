import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), review: vi.fn(), finalize: vi.fn(), moderate: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { performanceAdminData: mocks.data, submitPerformanceReview: mocks.review, finalizePerformance: mocks.finalize, moderateFeedback: mocks.moderate } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewPerformanceAdminPage from "../CrewPerformanceAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const row = { employee: { id: "employee-1", full_name: "Alex Tan", employee_code: "QA-01", position: "Service Crew" }, result: { id: "result-1", period_start: "2026-08-01", status: "review_required", total_score: 82, attendance_score: 28, service_score: 25, customer_score: 12, knowledge_score: 13, conduct_score: 4, calculation_version: "performance-v1", components: { service: { status: "reviewed", score: 25 }, conduct: { status: "review_required" } } } };
const fixture = { summary: { average_score: 82, crew_reviewed: 0, awaiting_review: 1, needs_attention: 0 }, crew: [row], reviews: [], feedback: [{ id: "feedback-1", submitted_at: "2026-08-12", employee_id: "employee-1", employee_name: "Alex Tan", experience: "great", positive_tags: ["Friendly"], improvement_tags: [], comment: "Great service", scoring_status: "included" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };
beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.review.mockReset().mockResolvedValue({}); mocks.finalize.mockReset().mockResolvedValue({}); mocks.moderate.mockReset().mockResolvedValue({}); });
afterEach(cleanup);

describe("Crew Performance Admin", () => {
  it("renders the server-derived overview and detail evidence", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Performance Overview" })).not.toBeNull();
    fireEvent.click(screen.getByText("Alex Tan"));
    expect(screen.getByRole("dialog", { name: /Alex Tan · Performance/ })).not.toBeNull();
    expect(screen.getAllByText("82").length).toBeGreaterThan(0);
  });

  it("submits a criteria review through the controlled authority", async () => {
    render(<CrewPerformanceAdminPage initialTab="reviews" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Meets Standard" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Submit Review" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "employee-1", component: "conduct" })));
  });

  it("keeps unfavorable feedback and records an audited exclusion", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exclude" }));
    fireEvent.change(screen.getByPlaceholderText(/Explain why/), { target: { value: "Duplicate guest submission" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Exclude" }).at(-1));
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith("feedback-1", true, "Duplicate guest submission"));
  });
});
