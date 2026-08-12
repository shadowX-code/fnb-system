import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  myAttendance: vi.fn(),
  attendanceContext: vi.fn(),
  learningHome: vi.fn(),
  growthMobile: vi.fn(),
  sopLibrary: vi.fn(),
  learningAssignment: vi.fn(),
  clock: vi.fn(),
  changePasscode: vi.fn(),
}));

vi.mock("../../../services/crewService.js", () => ({ crewService: mocks }));

import CrewMobileApp from "../CrewMobileApp.jsx";

const session = {
  token: "crew-token",
  expires_at: "2099-08-12T00:00:00Z",
  employee: { id: "employee-a", full_name: "Alex Tan", nickname: "Alex", position: "Service Crew" },
};
const growth = {
  employee_id: "employee-a",
  summary: { certified: 1, in_progress: 1, ready_for_review: 1, not_started: 0, total: 3 },
  skills: [
    { id: "skill-1", name: "Customer Greeting", category: "Service", status: "certified", requirements_completed: 2, requirements_total: 2, requirements: [], certification: { certified_at: "2026-08-12T00:00:00Z" } },
    { id: "skill-2", name: "Taking Orders", category: "Service", status: "ready_for_review", requirements_completed: 2, requirements_total: 3, requirements: [{ requirement_id: "req-1", label: "Manager Practical Assessment", detail: "Manager practical review pending", type: "practical", completed: false }] },
    { id: "skill-3", name: "Workstation Cleanliness", category: "Cleaning", status: "in_progress", requirements_completed: 1, requirements_total: 3, requirements: [] },
  ],
  timeline: [{ type: "sop", label: "Greeting SOP acknowledged", skill_name: "Customer Greeting", occurred_at: "2026-08-12T00:00:00Z" }],
  performance: null,
};

beforeEach(() => {
  localStorage.clear();
  mocks.signIn.mockReset().mockResolvedValue(session);
  mocks.myAttendance.mockReset().mockResolvedValue([]);
  mocks.attendanceContext.mockReset().mockResolvedValue({ outlet_name: "Friends Corner", location_enabled: false });
  mocks.learningHome.mockReset().mockResolvedValue({ assignment: { id: "assignment-1", progress_percentage: 25, lessons_completed: 2, lessons_total: 8 }, required_sops: [] });
  mocks.growthMobile.mockReset().mockResolvedValue(growth);
  mocks.sopLibrary.mockReset().mockResolvedValue({ categories: [], sops: [] });
  mocks.learningAssignment.mockReset().mockResolvedValue({ id: "assignment-1", journey: { name: "New Crew Onboarding" }, modules: [] });
  mocks.clock.mockReset().mockResolvedValue({});
  mocks.changePasscode.mockReset().mockResolvedValue({ token: "new-token", expires_at: "2099-08-13T00:00:00Z" });
});

afterEach(cleanup);

describe("Crew Mobile redesign", () => {
  it("uses a two-step mobile and custom passcode login that auto-submits four digits", async () => {
    render(<CrewMobileApp />);
    expect(screen.queryByText("Passcode")).toBeNull();
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "12 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Enter Passcode" })).not.toBeNull();
    for (const digit of [1, 2, 3, 4]) fireEvent.click(screen.getByRole("button", { name: String(digit) }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("+6012 345 6789", "1234"));
    expect(await screen.findByText("Alex", { selector: "h1" })).not.toBeNull();
  });

  it("has exactly Home, Learn, Reward, Growth and Me in bottom navigation", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    const nav = await screen.findByRole("navigation", { name: "Crew navigation" });
    expect(Array.from(nav.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Home", "Learn", "Reward", "Growth", "Me"]);
    expect(nav.textContent).not.toContain("Work");
    expect(nav.textContent).not.toContain("Performance");
  });

  it("keeps attendance as a contextual Home action instead of a primary tab", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Attendance.*Clock In.*Tap to start your shift/ }));
    expect(screen.getByRole("heading", { name: "Attendance" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clock In" })).not.toBeNull();
  });

  it("shows a truthful Reward shell without fabricated currency values", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[2]);
    expect(screen.getByRole("heading", { name: "Coming soon" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/RM\s*\d/);
  });

  it("shows only the signed-in employee's safe Growth state and no manager controls", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[3]);
    expect(await screen.findByText("63% complete")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Skills.*See requirements and evidence/ }));
    fireEvent.click(screen.getByRole("button", { name: /Taking Orders/ }));
    expect(screen.getByText("Manager Practical Assessment")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manager note");
    expect(screen.queryByRole("button", { name: /Certify|Submit Assessment/ })).toBeNull();
    expect(mocks.growthMobile).toHaveBeenCalledWith("crew-token");
  });
});
