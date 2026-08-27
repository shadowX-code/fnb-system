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

  it.each([0, 43, 87, 100])("renders exactly %s active score segments", (score) => {
    render(<CrewGrowthMobile data={data} performance={{ score, trend: [] }} />);
    expect(document.querySelectorAll(".crew-growth-performance-segment.is-active")).toHaveLength(score);
    expect(document.querySelectorAll(".crew-growth-performance-segment:not(.is-active)")).toHaveLength(100 - score);
  });

  it("opens the centered accessible help dialog and closes with Escape", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 75, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Growth help" }));
    const dialog = screen.getByRole("dialog", { name: "About Growth" });
    expect(dialog).not.toBeNull();
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

  it("renders the finalized Performance hero, unified breakdown, strengths, real trend and Reward impact", () => {
    const onViewReward = vi.fn();
    render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" onViewReward={onViewReward} />);
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
    expect(screen.getByText("Finalized")).not.toBeNull();
    expect(screen.getByText("Outstanding")).not.toBeNull();
    expect(screen.getByText("+13 vs July 2026")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Score Breakdown" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /^View (Attendance|Service Standards|Customer Experience|Knowledge & SOP|Conduct) evidence$/ })).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "Your Strengths" })).not.toBeNull();
    expect(screen.getByLabelText("Finalized monthly performance trend")).not.toBeNull();
    expect(screen.getByText("100%", { selector: ".crew-performance-final-reward strong" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View Reward/ }));
    expect(onViewReward).toHaveBeenCalledTimes(1);
  });

  it("opens safe centered component and help dialogs without manager-private content", () => {
    render(<CrewGrowthMobile data={data} performance={fullPerformance} initialView="performance" />);
    fireEvent.click(screen.getByRole("button", { name: "View Attendance evidence" }));
    expect(screen.getByRole("dialog", { name: "Attendance" })).not.toBeNull();
    expect(screen.getByText("15 of 15 completed")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Why this score" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Keep it up" })).not.toBeNull();
    expect(screen.getByText(/Location exceptions are not automatically penalized/)).not.toBeNull();
    expect(screen.getByRole("button", { name: "View Attendance" })).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manager note");
    fireEvent.click(screen.getByRole("button", { name: "Close Attendance" }));
    fireEvent.click(screen.getByRole("button", { name: "Performance help" }));
    expect(screen.getByRole("dialog", { name: "About My Performance" })).not.toBeNull();
    expect(screen.getByText(/Maximum Reward Share/)).not.toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Close Service Standards" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Close Customer Experience" }));
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
    [100, "Outstanding", "100%"], [87, "Strong", "80%"], [75, "Meets Standard", "45%"], [68, "Below Standard", "0%"],
  ])("maps score %s to %s and the existing Reward earn-rate tier", (score, level, earnRate) => {
    render(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, score, breakdown: {}, trend: [{ period_start: "2026-08-01", status: "finalized", score }] }} initialView="performance" />);
    expect(screen.getByText(level)).not.toBeNull();
    expect(screen.getByText(earnRate, { selector: ".crew-performance-final-reward strong" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Your Strengths" })).toBeNull();
    expect(screen.getByText(/monthly trend will appear/)).not.toBeNull();
  });

  it("labels non-finalized performance honestly and does not fabricate a delta or strengths", () => {
    render(<CrewGrowthMobile data={data} performance={{ ...fullPerformance, status: "review_required", score: 87, breakdown: {}, trend: [] }} initialView="performance" />);
    expect(screen.getByText("In Review")).not.toBeNull();
    expect(screen.getByText("Estimated · not finalized")).not.toBeNull();
    expect(screen.queryByText(/ vs /)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your Strengths" })).toBeNull();
  });
});
