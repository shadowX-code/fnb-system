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
    attendance: { score: 30, explanation: "Perfect attendance evidence this month." },
    service: { score: 30, explanation: "All reviewed standards met." },
    customer: { score: 15, explanation: "Consistently positive feedback received." },
    knowledge: { score: 15, explanation: "All required learning evidence completed." },
    conduct: { score: 10, explanation: "All reviewed conduct standards met." },
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
  it("prioritizes ready review, consolidates Skills, and removes Path and Certifications from home", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 100, trend: [] }} />);
    expect(screen.getByRole("heading", { name: "Closing Responsibilities" })).not.toBeNull();
    expect(screen.getByText("Your Skills")).not.toBeNull();
    expect(screen.getAllByText("Ready for Review").length).toBeGreaterThan(0);
    expect(screen.queryByText("My Path")).toBeNull();
    expect(screen.queryByText("My Certifications")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Growth sections" })).toBeNull();
    expect(screen.getByText("Outstanding")).not.toBeNull();
  });

  it("uses the required milestone priority and does not invent a milestone when all skills are certified", () => {
    const { rerender } = render(<CrewGrowthMobile data={{ ...data, skills: skills.filter((skill) => skill.status !== "ready_for_review") }} performance={null} />);
    expect(screen.getByRole("heading", { name: "Workstation Cleanliness" })).not.toBeNull();
    rerender(<CrewGrowthMobile data={{ summary: { certified: 1, in_progress: 0, ready_for_review: 0, not_started: 0, total: 1 }, skills: [skills[0]], timeline: [] }} performance={null} />);
    expect(screen.getByRole("heading", { name: "All caught up" })).not.toBeNull();
    expect(screen.getByText("Your current skills are up to date.")).not.toBeNull();
  });

  it("opens the centered accessible help dialog and closes with Escape", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 75, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Growth help" }));
    expect(screen.getByRole("dialog", { name: "About Growth" })).not.toBeNull();
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

  it("routes the unified Skills and Performance calls to the existing detail surfaces", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 87, trend: [] }} />);
    fireEvent.click(screen.getAllByRole("button", { name: /View all skills/ })[0]);
    expect(screen.getByRole("heading", { name: "Skills" })).not.toBeNull();
    expect(screen.getByText(/Ready for Review · 1/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "View my performance" }));
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
  });

  it("returns from Skill Detail to the surface that opened it", () => {
    render(<CrewGrowthMobile data={data} performance={{ score: 87, trend: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /View skill/ }));
    expect(screen.getByRole("heading", { name: "Skill Detail" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Growth" })).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /View all skills/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Closing Responsibilities/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Skills" })).not.toBeNull();
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
    expect(screen.getAllByText("Perfect attendance evidence this month.").length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("Manager note");
    fireEvent.click(screen.getByRole("button", { name: "Close Attendance" }));
    fireEvent.click(screen.getByRole("button", { name: "Performance help" }));
    expect(screen.getByRole("dialog", { name: "About My Performance" })).not.toBeNull();
    expect(screen.getByText(/Maximum Reward Share/)).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "About My Performance" })).toBeNull();
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
