import { afterEach, describe, expect, it } from "vitest";
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
});
