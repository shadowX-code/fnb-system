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
  calculation_version: "performance-v1",
  breakdown: {
    attendance: { score: 30, explanation: "Perfect attendance evidence this month.", evidence: { records: 15, completed: 15, incomplete: 0, location_exceptions: 1, approved_leave_days: 1 } },
    service: { score: 30, explanation: "All reviewed standards met.", criteria: [
      { key: "welcome_greeting", rating: "meets_standard" }, { key: "thank_you_goodbye", rating: "meets_standard" }, { key: "grooming", rating: "meets_standard" },
      { key: "work_area_cleanliness", rating: "meets_standard" }, { key: "initiative", rating: "meets_standard" }, { key: "guest_interaction", rating: "meets_standard" },
    ] },
    customer: { score: 15, sample_count: 28, confidence: "established", positive_count: 23, improvement_count: 5, top_positive_tags: [{ tag: "friendly", count: 12 }], top_improvement_tags: [{ tag: "response_time", count: 2 }], explanation: "Consistently positive feedback received." },
    knowledge: { score: 15, explanation: "All required learning evidence completed.", evidence: { onboarding_ratio: 1, sop_ratio: 1, quiz_ratio: 1, growth_ratio: 1 } },
    conduct: { score: 10, explanation: "All reviewed conduct standards met.", criteria: [
      { key: "professional_conduct", rating: "meets_standard" }, { key: "teamwork", rating: "meets_standard" }, { key: "responsibility", rating: "meets_standard" },
      { key: "communication", rating: "meets_standard" }, { key: "policy_compliance", rating: "meets_standard" },
    ] },
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
    render(<CrewGrowthMobile data={data} performance={{ score: 87, trend: [] }} />);
    expect(screen.getByText("Strong")).not.toBeNull();
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

  it("presents the score-point comparison without raw floating-point precision", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 67, period_start: "2026-09-01", trend: [
      { period_start: "2026-08-01", status: "finalized", score: 86.93 },
      { period_start: "2026-09-01", status: "finalized", score: 67 },
    ] }} />);
    expect(screen.getByText("↓ 19.9 pts")).not.toBeNull();
    expect(screen.getByText("vs August 2026")).not.toBeNull();
    expect(document.body.textContent).not.toContain("-19.930000000000007");
  });

  it.each([0, 1, 50, 87, 100])("renders exactly %s active score segments", (score) => {
    render(<CrewGrowthMobile data={data} performance={{ score, trend: [] }} />);
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(score);
    expect(document.querySelectorAll(".crew-growth-performance-segment:not(.is-active)")).toHaveLength(100 - score);
    expect(document.querySelectorAll(".crew-growth-performance-highlight-segment")).toHaveLength(score);
  });

  it("updates the same score ring when the canonical Performance score changes", () => {
    const { rerender } = render(<CrewGrowthMobile data={data} performance={{ score: 43, trend: [] }} />);
    rerender(<CrewGrowthMobile data={data} performance={{ score: 87, trend: [] }} />);
    expect(screen.getByLabelText("87 / 100")).not.toBeNull();
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(87);
    expect(document.querySelectorAll(".crew-growth-performance-highlight-segment")).toHaveLength(87);
  });

  it("uses the shared bottom-sheet help surface and closes with Escape", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 75, trend: [] }} />);
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
    render(<CrewGrowthMobile data={data} performance={{ score, trend: [] }} />);
    expect(screen.getByText(level)).not.toBeNull();
    expect(document.body.textContent).not.toContain("Earn Rate");
  });

  it("routes the performance CTA to the existing Performance detail surface", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 87, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "View my performance" }));
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
  });

  it("opens each direct Growth skill row and returns to the Growth overview", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 87, trend: [] }} />);
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
    expect(screen.getAllByRole("button", { name: /^View (Attendance|Service Standards|Customer Experience|Knowledge & SOP|Conduct) evidence$/ })).toHaveLength(5);
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
    expect(screen.getByText(/Location exceptions are not automatically penalized/)).not.toBeNull();
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

  it("derives Service and Conduct guidance from safe criteria without exposing private notes", () => {
    const scoped = { ...fullPerformance, breakdown: {
      ...fullPerformance.breakdown,
      service: { score: 25, manager_note: "private coaching", criteria: [{ key: "welcome_greeting", rating: "meets_standard" }, { key: "work_area_cleanliness", rating: "needs_improvement" }, { key: "initiative", rating: "not_observed" }] },
      conduct: { score: 8, manager_note: "private conduct note", criteria: [{ key: "teamwork", rating: "meets_standard" }, { key: "responsibility", rating: "needs_improvement" }] },
    } };
    render(<CrewGrowthMobile data={data} performance={scoped} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Service Standards evidence" }));
    expect(screen.getByText("Work Area Cleanliness")).not.toBeNull();
    expect(screen.getByText("Needs Improvement")).not.toBeNull();
    expect(screen.getByText(/Keep your assigned work area clean/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("private coaching");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "View Conduct evidence" }));
    expect(screen.getByText(/Take ownership of assigned tasks/)).not.toBeNull();
    expect(document.body.textContent).not.toContain("private conduct note");
  });

  it("explains established and insufficient Customer Experience evidence without inventing a rating or CTA", () => {
    const { rerender } = render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Customer Experience evidence" }));
    expect(screen.getByText("28 responses")).not.toBeNull();
    expect(screen.getByText("Friendly")).not.toBeNull();
    expect(screen.getByText("Response Time")).not.toBeNull();
    expect(screen.getByText("Respond to guest requests quickly.")).not.toBeNull();
    expect(screen.queryByText(/★/)).toBeNull();
    expect(screen.queryByRole("button", { name: /feedback/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    rerender(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, breakdown: { ...fullPerformance.breakdown, customer: { score: 12, sample_count: 0, positive_count: 0, improvement_count: 0, confidence: "insufficient_data" } } }} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Customer Experience evidence" }));
    expect(screen.getAllByText("Insufficient data").length).toBeGreaterThan(0);
    expect(screen.getByText(/More verified guest feedback is needed/)).not.toBeNull();
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
