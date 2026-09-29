import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrewGrowthMobile from "../CrewGrowthMobile.jsx";

const skills = [
  { id: "certified", name: "Customer Greeting", category: "Service", status: "certified", requirements_completed: 2, requirements_total: 2, requirements: [], certification: { certified_at: "2026-08-01" } },
  { id: "ready", name: "Closing Responsibilities", category: "Opening & Closing", status: "ready_for_review", requirements_completed: 3, requirements_total: 3, requirements: [] },
  { id: "progress", name: "Workstation Cleanliness", category: "Cleaning", status: "in_progress", requirements_completed: 1, requirements_total: 3, requirements: [] },
  { id: "new", name: "Opening Readiness", category: "Opening & Closing", status: "not_started", requirements_completed: 0, requirements_total: 2, requirements: [] },
];

const data = {
  summary: { certified: 1, in_progress: 1, ready_for_review: 1, not_started: 1, total: 4 },
  skills,
  timeline: [],
};

const fullPerformance = {
  period_start: "2026-08-01",
  status: "finalized",
  score: 100,
  calculation_version: "performance-v2",
  breakdown: {
    attendance: { score: 30, explanation: "Perfect attendance evidence this month.", evidence: { records: 15, completed: 15, incomplete: 0, location_exceptions: 1, approved_leave_days: 1 } },
    service: { score: 30, explanation: "All reviewed standards met.", criteria: [
      { key: "welcome_greeting", rating: "meets_standard" }, { key: "thank_you_goodbye", rating: "meets_standard" }, { key: "grooming", rating: "meets_standard" },
      { key: "work_area_cleanliness", rating: "meets_standard" }, { key: "guest_interaction", rating: "meets_standard" },
    ] },
    customer: { score: 20, max_score: 20, calculation_version: "performance-v2", explanation: "Finalized Google evidence." },
    knowledge: { score: 15, explanation: "All required learning evidence completed.", evidence: { onboarding_ratio: 1, sop_ratio: 1, quiz_ratio: 1, growth_ratio: 1 } },
    peer: { score: 5, max_score: 5, completed: 3, required: 3, dimensions: { teamwork: 5, reliability: 5, communication: 5, work_attitude: 5 } },
  },
  trend: [
    { period_start: "2026-05-01", status: "finalized", score: 78 },
    { period_start: "2026-06-01", status: "finalized", score: 84 },
    { period_start: "2026-07-01", status: "finalized", score: 87 },
    { period_start: "2026-08-01", status: "finalized", score: 100 },
  ],
};

afterEach(cleanup);

describe("Crew Growth mobile final IA", () => {
  it("makes Performance the sole hero and shows the complete Skills overview directly on Growth", () => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 87, trend: [] }} />);
    expect(screen.getByRole("heading", { name: "This month" })).not.toBeNull();
    expect(screen.getByText("Finalized")).not.toBeNull();
    expect(screen.getByLabelText("87 / 100")).not.toBeNull();
    expect(document.querySelectorAll(".crew-growth-performance-segment")).toHaveLength(100);
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(87);
    expect(document.querySelectorAll(".crew-growth-performance-segment:not(.is-active)")).toHaveLength(13);
    expect(document.querySelectorAll(".crew-growth-performance-highlight-segment")).toHaveLength(87);
    expect(document.querySelector(".crew-growth-performance-score-readout")).not.toBeNull();
    expect(document.querySelector(".crew-growth-performance-score-disc")).toBeNull();
    expect(screen.getByText("Skills Overview")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "All Skills 4" })).not.toBeNull();
    expect(screen.getByText("Closing Responsibilities")).not.toBeNull();
    expect(screen.getByText("Workstation Cleanliness")).not.toBeNull();
    expect(screen.getByText("Opening Readiness")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sort: Status" })).not.toBeNull();
    expect(screen.queryByText("Next Milestone")).toBeNull();
    expect(screen.queryByText("Recommended for you")).toBeNull();
    expect(screen.queryByRole("button", { name: /View all skills/ })).toBeNull();
    expect(screen.queryByText("My Path")).toBeNull();
    expect(screen.queryByText("My Certifications")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Growth sections" })).toBeNull();
  });

  it("keeps the hero score singular when there is no Performance data", () => {
    render(<CrewGrowthMobile data={data} performance={null} />);
    expect(screen.getByLabelText("Awaiting data")).not.toBeNull();
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(0);
    expect(screen.queryByText("Next Milestone")).toBeNull();
  });

  it("keeps finalized comparison detail in My Performance rather than the Growth summary", () => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 67, period_start: "2026-09-01", trend: [
      { period_start: "2026-08-01", status: "finalized", score: 86.93 },
      { period_start: "2026-09-01", status: "finalized", score: 67 },
    ] }} />);
    expect(screen.getByRole("heading", { name: "September Performance" })).not.toBeNull();
    expect(screen.queryByText("↓ 19.9 pts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View my performance" }));
    expect(screen.getByText("↓ 19.9 pts")).not.toBeNull();
    expect(screen.getByText("vs August 2026")).not.toBeNull();
    expect(document.body.textContent).not.toContain("-19.930000000000007");
  });

  it("presents a partial score as current work in progress without a performance band or prior-month comparison", () => {
    const partialPerformance = {
      period_start: "2026-09-01", status: "review_required", score_state: "partial", score: 44, current_score: 44, total_score: null,
      scored_components: 3, pending_components: 2, total_components: 5,
      calculation_version: "performance-v2", pending_component_names: ["customer", "service"],
      breakdown: { attendance: { score: 24 }, customer: { score: null, max_score: 20, status: "pending" }, knowledge: { score: 15 }, service: { score: null }, peer: { score: 5 } },
      trend: [{ period_start: "2026-08-01", status: "finalized", score: 86 }],
    };
    const { rerender } = render(<CrewGrowthMobile data={data} performance={partialPerformance} />);
    expect(screen.getByRole("heading", { name: "September Performance" })).not.toBeNull();
    expect(screen.getByText("3 of 5 areas completed")).not.toBeNull();
    expect(screen.queryByText("44 points assessed")).toBeNull();
    expect(screen.getByLabelText("44 points so far")).not.toBeNull();
    expect(screen.queryByText("Below Standard")).toBeNull();
    expect(screen.queryByText("↓ 35 pts")).toBeNull();
    rerender(<CrewGrowthMobile data={data} performance={partialPerformance} initialView="performance" />);
    expect(screen.getByText("Points so far")).not.toBeNull();
    expect(screen.getByText("3 of 5 areas completed")).not.toBeNull();
    expect(screen.queryByText("44 points assessed")).toBeNull();
    expect(screen.queryByText("Below Standard")).toBeNull();
    expect(screen.queryByText("vs August 2026")).toBeNull();
  });

  it("presents V2 progress without repeating pending component names or a final denominator", () => {
    const performance = {
      period_start: "2026-09-01", status: "review_required", calculation_version: "performance-v2",
      score_state: "partial", score: 45, current_score: 45, total_score: null,
      scored_components: 3, pending_components: 2, total_components: 5,
      pending_component_names: ["customer", "peer"],
      breakdown: { attendance: { score: 25, max_score: 30 }, service: { score: 12, max_score: 30 },
        customer: { score: null, max_score: 20, status: "pending" }, knowledge: { score: 8, max_score: 15 },
        peer: { score: null, max_score: 5, status: "pending", completed: 1, required: 3 } },
      trend: [{ period_start: "2026-08-01", status: "finalized", score: 88 }],
    };
    const { rerender } = render(<CrewGrowthMobile data={data} performance={performance} />);
    expect(screen.getByText("3 of 5 areas completed")).not.toBeNull();
    expect(screen.queryByText(/Pending: Customer/)).toBeNull();
    expect(screen.queryByText("Final Score /100")).toBeNull();
    expect(screen.queryByText("Below Standard")).toBeNull();
    rerender(<CrewGrowthMobile data={data} performance={performance} initialView="performance" />);
    expect(screen.getByText("Points so far")).not.toBeNull();
    expect(screen.getAllByText("Pending")).toHaveLength(2);
    expect(screen.queryByText(/Weight /)).toBeNull();
    expect(screen.queryByText(/points assessed/)).toBeNull();
    expect(screen.getAllByText("Team Review").length).toBeGreaterThan(0);
    expect(screen.queryByText("Conduct")).toBeNull();
  });

  it("does not give an unscored V2 month a final denominator or band", () => {
    const performance = { period_start: "2026-09-01", status: "review_required", calculation_version: "performance-v2",
      score_state: "unavailable", score: null, current_score: 0, total_score: null,
      scored_components: 0, pending_components: 5, total_components: 5,
      pending_component_names: ["attendance", "service", "customer", "knowledge", "peer"], trend: [] };
    const { rerender } = render(<CrewGrowthMobile data={data} performance={performance} />);
    expect(document.querySelector(".crew-growth-performance-score-readout b")).toBeNull();
    expect(screen.getByText("0 of 5 areas completed")).not.toBeNull();
    rerender(<CrewGrowthMobile data={data} performance={performance} initialView="performance" />);
    expect(document.querySelector(".crew-performance-final-total span")).toBeNull();
    expect(screen.getAllByText("Pending")).toHaveLength(5);
    expect(screen.queryByText("Below Standard")).toBeNull();
  });

  it.each([0, 1, 50, 87, 100])("renders exactly %s active score segments", (score) => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score, trend: [] }} />);
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(score);
    expect(document.querySelectorAll(".crew-growth-performance-segment:not(.is-active)")).toHaveLength(100 - score);
    expect(document.querySelectorAll(".crew-growth-performance-highlight-segment")).toHaveLength(score);
  });

  it("updates the same score ring when the canonical Performance score changes", () => {
    const { rerender } = render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 43, trend: [] }} />);
    rerender(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 87, trend: [] }} />);
    expect(screen.getByLabelText("87 / 100")).not.toBeNull();
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(87);
    expect(document.querySelectorAll(".crew-growth-performance-highlight-segment")).toHaveLength(87);
  });

  it("uses the shared bottom-sheet help surface and closes with Escape", () => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 75, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Growth help" }));
    const dialog = screen.getByRole("dialog", { name: "About Growth" });
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains("crew-ui-help-sheet")).toBe(true);
    expect(dialog.parentElement.parentElement).toBe(document.body);
    expect(document.body.style.position).toBe("fixed");
    expect(screen.getByText("Your monthly performance score reflects your verified work evidence.")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "About Growth" })).toBeNull();
  });

  it.each([
    [100, "Outstanding"], [94, "Excellent"], [87, "Strong"], [82, "Good"], [77, "Meets Standard"], [72, "Developing"], [60, "Below Standard"],
  ])("maps performance score %s to %s without exposing Reward earn rates", (score, level) => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score, trend: [] }} />);
    expect(screen.queryByText(level)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View my performance" }));
    expect(screen.getByText(level)).not.toBeNull();
    expect(document.body.textContent).not.toContain("Earn Rate");
  });

  it("routes the performance CTA to the existing Performance detail surface", () => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 87, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "View my performance" }));
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
  });

  it("opens each direct Growth skill row and returns to the Growth overview", () => {
    render(<CrewGrowthMobile data={data} performance={{ status: "finalized", score: 87, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Closing Responsibilities/ }));
    expect(screen.getByRole("heading", { name: "Skill Detail" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Growth" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "All Skills 4" })).not.toBeNull();
  });

  it("renders the approved light Performance hero, shared section headings, breakdown, strengths and trend without duplicate Reward content", () => {
    render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" />);
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
    const hero = document.querySelector(".crew-performance-final-hero");
    expect(hero.style.getPropertyValue("--crew-performance-detail-background")).toContain("performance-detail-hero-approved");
    expect(document.querySelector(".crew-performance-final-signal")).toBeNull();
    expect(screen.getByText("Finalized")).not.toBeNull();
    expect(screen.getByText("Outstanding")).not.toBeNull();
    expect(screen.getByText("↑ 13 pts")).not.toBeNull();
    expect(screen.getByText("vs July 2026")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Score Breakdown" })).not.toBeNull();
    expect(screen.queryByText(/Weight \d+%/)).toBeNull();
    expect(screen.queryByText(/points assessed/)).toBeNull();
    expect(document.querySelector(".crew-performance-final-breakdown-head strong")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^View (Attendance|Service Standards|Customer Experience|Knowledge & SOP|Team Review) evidence$/ })).toHaveLength(5);
    expect(document.querySelector(".crew-performance-final-evidence")).toBeNull();
    expect(screen.getByRole("heading", { name: "Your Strengths" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Performance Trend" })).not.toBeNull();
    expect(screen.getByText("Last 4 months", { selector: ".crew-performance-final-trend-context" })).not.toBeNull();
    expect(screen.getByLabelText("Finalized monthly performance trend")).not.toBeNull();
    expect(document.querySelector(".crew-performance-final-reward")).toBeNull();
    expect(screen.queryByRole("button", { name: /View Reward/ })).toBeNull();
  });

  it("keeps the rich component detail viewer distinct from explanatory help while sharing the mobile sheet shell", () => {
    render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Attendance evidence" }));
    const detailSheet = screen.getByRole("dialog", { name: "Attendance" });
    expect(detailSheet.classList.contains("crew-performance-detail-sheet")).toBe(true);
    expect(detailSheet.classList.contains("crew-ui-bottom-sheet")).toBe(true);
    expect(screen.getByText("15 of 15 completed")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Why this score" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Keep it up" })).not.toBeNull();
    expect(screen.getByText(/15 points for completed eligible shifts and 15 points for punctuality/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "View Attendance" })).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manager note");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Performance help" }));
    expect(screen.getByRole("dialog", { name: "About My Performance" }).classList.contains("crew-ui-help-sheet")).toBe(true);
    expect(screen.queryByText(/Maximum Reward Share/)).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "About My Performance" })).toBeNull();
  });

  it("uses non-full Attendance evidence to surface the verified gap and actionable guidance", () => {
    render(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, breakdown: { ...fullPerformance.breakdown, attendance: { score: 28, evidence: { records: 15, completed: 14, incomplete: 1, location_exceptions: 1, approved_leave_days: 2 } } } }} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Attendance evidence" }));
    expect(screen.getByText("14 of 15 completed")).not.toBeNull();
    expect(screen.getByText("2 days excluded")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "How to improve" })).not.toBeNull();
    expect(screen.getByText(/Complete both clock-in and clock-out/)).not.toBeNull();
  });

  it("derives Service guidance from safe criteria without exposing private notes", () => {
    const scoped = { ...fullPerformance, breakdown: {
      ...fullPerformance.breakdown,
      service: { score: 25, manager_note: "private coaching", criteria: [{ key: "welcome_greeting", rating: "meets_standard" }, { key: "work_area_cleanliness", rating: "needs_improvement" }, { key: "guest_interaction", rating: "not_observed" }] },
    } };
    render(<CrewGrowthMobile data={data} performance={scoped} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Service Standards evidence" }));
    expect(screen.getByText("Work Area Cleanliness")).not.toBeNull();
    expect(screen.getByText("Needs Improvement")).not.toBeNull();
    expect(screen.getByText(/Keep your assigned work area clean/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("private coaching");
    expect(screen.queryByRole("button", { name: "View Conduct evidence" })).toBeNull();
  });

  it("shows Google Customer evidence only when available and keeps pending evidence unscored", () => {
    const { rerender } = render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Customer Experience evidence" }));
    expect(screen.getByText(/Google reviews/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /feedback/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    rerender(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, status: "review_required", score_state: "partial", score: 80, current_score: 80, total_score: null, pending_component_names: ["customer"], breakdown: { ...fullPerformance.breakdown, customer: { score: null, max_score: 20, calculation_version: "performance-v2", status: "pending" } } }} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Customer Experience evidence" }));
    expect(screen.getAllByText(/Awaiting Evidence/i).length).toBeGreaterThan(0);
  });

  it("maps Knowledge evidence to precise missing actions and the existing Learn route", () => {
    const onNavigate = vi.fn();
    render(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, breakdown: { ...fullPerformance.breakdown, knowledge: { score: 10, evidence: { onboarding_ratio: 1, sop_ratio: 0.75, quiz_ratio: 0.5, growth_ratio: 1 } } } }} initialView="performance" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "View Knowledge & SOP evidence" }));
    expect(screen.getByText("75% acknowledged")).not.toBeNull();
    expect(screen.getByText("50% passed")).not.toBeNull();
    expect(screen.getByText("Complete outstanding SOP acknowledgements.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Go to Learn/ }));
    expect(onNavigate).toHaveBeenCalledWith("learn");
  });

  it("uses only existing actionable deep links for Attendance, Service, Knowledge and Conduct", () => {
    const onNavigate = vi.fn();
    render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "View Attendance evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "View Attendance" }));
    expect(onNavigate).toHaveBeenCalledWith("attendance");
  });

  it.each([
    [100, "Outstanding"], [87, "Strong"], [75, "Meets Standard"], [68, "Below Standard"],
  ])("maps score %s to %s without duplicating Reward earn-rate information", (score, level) => {
    render(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, score, breakdown: {}, trend: [{ period_start: "2026-08-01", status: "finalized", score }] }} initialView="performance" />);
    expect(screen.getByText(level)).not.toBeNull();
    expect(document.querySelector(".crew-performance-final-reward")).toBeNull();
    expect(document.body.textContent).not.toContain("Earn Rate");
    expect(screen.queryByRole("heading", { name: "Your Strengths" })).toBeNull();
    expect(screen.getByText(/monthly trend will appear/)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Latest finalized result" })).not.toBeNull();
    expect(screen.getByText("Performance Score")).not.toBeNull();
    expect(screen.getByText(`${score}/100`)).not.toBeNull();
  });

  it("keeps a multi-period trend explicit with score units", () => {
    render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" />);
    expect(screen.getByRole("heading", { name: "Performance Trend" })).not.toBeNull();
    expect(screen.getByText("Performance Score", { selector: ".crew-performance-final-trend-score-label" })).not.toBeNull();
    expect(document.querySelector(".crew-performance-final-chart")).not.toBeNull();
  });

  it("labels non-finalized performance honestly and does not fabricate a delta or strengths", () => {
    render(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, status: "review_required", score: 87, breakdown: {}, trend: [] }} initialView="performance" />);
    expect(screen.getByText("In Review")).not.toBeNull();
    expect(document.querySelector(".crew-performance-final-reward")).toBeNull();
    expect(screen.queryByText(/ vs /)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your Strengths" })).toBeNull();
  });
});
