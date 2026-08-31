import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), review: vi.fn(), finalize: vi.fn(), moderate: vi.fn(), correct: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { performanceAdminData: mocks.data, submitPerformanceReview: mocks.review, finalizePerformance: mocks.finalize, moderateFeedback: mocks.moderate, correctFeedbackAttribution: mocks.correct } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import CrewPerformanceAdminPage from "../CrewPerformanceAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const row = { employee: { id: "employee-1", full_name: "Alex Tan", employee_code: "QA-01", position: "Service Crew" }, result: { id: "result-1", period_start: "2026-08-01", status: "review_required", total_score: 82, attendance_score: 28, service_score: 25, customer_score: 12, knowledge_score: 13, conduct_score: 4, calculation_version: "performance-v1", components: { attendance: { max_score: 30 }, service: { status: "reviewed", score: 25, max_score: 30 }, customer: { max_score: 15 }, knowledge: { max_score: 15 }, conduct: { status: "review_required", max_score: 10 } } } };
const attentionRow = { employee: { id: "employee-2", full_name: "Mina Lee", employee_code: "QA-02", position: "Kitchen Crew" }, result: { id: "result-2", period_start: "2026-08-01", status: "finalized", total_score: 60, attendance_score: 26, service_score: 18, customer_score: 8, knowledge_score: 0, conduct_score: 8, calculation_version: "performance-v1", components: { attendance: { max_score: 30 }, service: { status: "reviewed", score: 18, max_score: 30 }, customer: { max_score: 15 }, knowledge: { max_score: 15 }, conduct: { status: "reviewed", score: 8, max_score: 10 } } } };
const unscoredRow = { employee: { id: "employee-3", full_name: "Pending Score", employee_code: "QA-03", position: "Service Crew" }, result: { id: "result-3", period_start: "2026-08-01", status: "review_required", total_score: null, attendance_score: 30, service_score: null, customer_score: 12, knowledge_score: 14, conduct_score: null, calculation_version: "performance-v1", components: { attendance: { max_score: 30 }, service: { status: "review_required", max_score: 30 }, customer: { max_score: 15 }, knowledge: { max_score: 15 }, conduct: { status: "review_required", max_score: 10 } } } };
const feedback = [{ id: "feedback-1", submitted_at: "2026-08-12", employee_id: "employee-1", employee_name: "Alex Tan", experience: "great", positive_tags: ["Friendly"], improvement_tags: [], comment: "Great service", scoring_status: "included", moderation_history: [], attribution_history: [] }, { id: "feedback-2", submitted_at: "2026-08-13", employee_id: "employee-2", employee_name: "Mina Lee", experience: "needs_improvement", positive_tags: [], improvement_tags: ["Response Time"], comment: "Too slow", scoring_status: "excluded", exclusion_reason: "Duplicate guest submission", excluded_by_name: "Admin", excluded_at: "2026-08-13T10:30:00Z", moderation_history: [{ id: "moderation-1", previous_status: "included", next_status: "excluded", reason: "Duplicate guest submission", changed_by: "Admin", changed_at: "2026-08-13T10:30:00Z" }], attribution_history: [] }];
const fixture = { summary: { average_score: 71, crew_reviewed: 1, awaiting_review: 1, needs_attention: 1 }, crew: [row, attentionRow], reviews: [], feedback, feedback_summary: { total_feedback: 2, included_feedback: 1, positive_feedback: 1, needs_improvement_feedback: 0, excluded_feedback: 1 }, feedback_crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", availability: "active" }, { id: "employee-2", name: "Mina Lee", position: "Kitchen Crew", availability: "active" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };
beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.review.mockReset().mockResolvedValue({}); mocks.finalize.mockReset().mockResolvedValue({}); mocks.moderate.mockReset().mockResolvedValue({}); mocks.correct.mockReset().mockResolvedValue({}); });
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

  it("keeps period KPIs independent from table filters and makes excluded evidence recoverable", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("All submissions this period")).not.toBeNull();
    expect(screen.getByText("2", { selector: ".crew-growth-metric strong" })).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search Crew, comment or tag"), { target: { value: "Alex" } });
    expect(screen.getByText("Great service")).not.toBeNull();
    expect(screen.queryByText("Too slow")).toBeNull();
    expect(screen.getByText("2", { selector: ".crew-growth-metric strong" })).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search Crew, comment or tag"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Feedback scoring" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluded" }));
    expect(screen.getByText("Too slow")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.change(screen.getByPlaceholderText("Explain why this feedback should return to scoring"), { target: { value: "Duplicate was rechecked" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore To Scoring" }));
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith("feedback-2", false, "Duplicate was rechecked"));
  });

  it("opens retained evidence history and corrects attribution through the controlled service", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("Great service");
    fireEvent.click(screen.getByRole("button", { name: "View feedback details for Mina Lee" }));
    expect(screen.getByRole("dialog", { name: "Feedback Detail" })).not.toBeNull();
    expect(screen.getByText("Duplicate guest submission", { selector: "span" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct Crew attribution for Alex Tan" }));
    fireEvent.change(screen.getByPlaceholderText("Explain why this feedback belongs to a different Crew member"), { target: { value: "Guest selected the wrong Crew member" } });
    fireEvent.click(screen.getByRole("radio", { name: /Mina Lee/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Correction" }));
    await waitFor(() => expect(mocks.correct).toHaveBeenCalledWith("feedback-1", "employee-2", "Guest selected the wrong Crew member"));
  });

  it("does not classify an unscored review-required employee as below-threshold attention", async () => {
    mocks.data.mockResolvedValue({ ...fixture, crew: [attentionRow, unscoredRow] });
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("1 Crew may need manager support.")).not.toBeNull();
    expect(screen.getAllByText("Mina Lee").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pending Score", { selector: ".crew-performance-attention-list *" })).toBeNull();
  });
});
