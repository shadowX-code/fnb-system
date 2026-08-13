import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  myAttendance: vi.fn(),
  attendanceContext: vi.fn(),
  learningHome: vi.fn(),
  growthMobile: vi.fn(),
  performanceMobile: vi.fn(),
  rewardMobile: vi.fn(),
  operationsToday: vi.fn(),
  myRoster: vi.fn(),
  myLeave: vi.fn(),
  operationDetail: vi.fn(),
  updateOperationItem: vi.fn(),
  completeOperationChecklist: vi.fn(),
  updateDailyTask: vi.fn(),
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
const performance = { period_start: "2026-08-01", status: "finalized", score: 87, calculation_version: "performance-v1", breakdown: { attendance: { score: 28, explanation: "Verified attendance evidence." }, service: { score: 26, explanation: "Reviewed standards." }, customer: { score: 13, confidence: "established", explanation: "Five responses." }, knowledge: { score: 14, explanation: "Learning evidence." }, conduct: { score: 6, explanation: "Reviewed conduct." } }, trend: [{ period_start: "2026-08-01", score: 87, status: "finalized" }] };
const reward = { period_start: "2026-08-01", status: "qualified", cycle_status: "review", reward_label: "Estimated Reward", reward_amount: 120.72, estimated_reward: 120.72, performance_score: 75, performance_level: "Meets Standard", earn_rate: .45, eligible_hours: 235, total_eligible_hours: 730, contribution_share: .3219, maximum_share: 268.33, reward_pool: 500, calculation_version: "reward-tier-v2", projection_applicable: true, projections: [{ key: "current", label: "Current", score: 75, earn_rate: .45, amount: 120.72 }, { key: "on_track", label: "On Track", score: 80, earn_rate: .65, amount: 174.41 }, { key: "great", label: "Great", score: 85, earn_rate: .8, amount: 214.66 }, { key: "max", label: "Max Potential", score: 95, earn_rate: 1, amount: 268.33 }], history: [{ period_start: "2026-07-01", amount: 112.4, status: "paid", paid_at: "2026-08-05T00:00:00Z" }] };

beforeEach(() => {
  localStorage.clear();
  mocks.signIn.mockReset().mockResolvedValue(session);
  mocks.myAttendance.mockReset().mockResolvedValue([]);
  mocks.attendanceContext.mockReset().mockResolvedValue({ outlet_name: "Friends Corner", location_enabled: false });
  mocks.learningHome.mockReset().mockResolvedValue({ assignment: { id: "assignment-1", progress_percentage: 25, lessons_completed: 2, lessons_total: 8 }, required_sops: [] });
  mocks.growthMobile.mockReset().mockResolvedValue(growth);
  mocks.performanceMobile.mockReset().mockResolvedValue(performance);
  mocks.rewardMobile.mockReset().mockResolvedValue(reward);
  mocks.operationsToday.mockReset().mockResolvedValue({ outlet: { id: "outlet-1", name: "Friends Corner" }, attendance_context: { on_shift: false }, checklists: [{ id: "ops-1", name: "Opening Checklist", type: "opening", status: "not_started", item_count: 2, completed_count: 0 }], daily_tasks: [{ id: "task-1", title: "Check reservation board", status: "pending", priority: "normal" }] });
  mocks.myRoster.mockReset().mockResolvedValue({ from: "2026-08-13", to: "2026-08-26", today: { entry_id: "roster-1", date: "2026-08-13", outlet_id: "outlet-1", outlet_name: "Friends Corner", start_time: "10:00", end_time: "18:00", entry_type: "working", position: "Service Crew" }, entries: [{ id: "roster-1", date: "2026-08-13", outlet: { id: "outlet-1", name: "Friends Corner" }, start_time: "10:00", end_time: "18:00", entry_type: "working", position: "Service Crew", template: { code: "MORNING", name: "Morning" } }, { id: "roster-2", date: "2026-08-14", outlet: { id: "outlet-2", name: "Hola Hola" }, entry_type: "off", template: { code: "OFF", name: "OFF" } }] });
  mocks.myLeave.mockReset().mockResolvedValue({ requests: [], upcoming: [] });
  mocks.operationDetail.mockReset().mockResolvedValue({ id: "ops-1", name: "Opening Checklist", type: "opening", status: "not_started", items: [{ id: "item-1", title: "Unlock guest entrance", required: true, status: "pending" }] });
  mocks.updateOperationItem.mockReset().mockResolvedValue({});
  mocks.completeOperationChecklist.mockReset().mockResolvedValue({});
  mocks.updateDailyTask.mockReset().mockResolvedValue({});
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
    fireEvent.click(await screen.findByRole("button", { name: "Attendance Clock In" }));
    expect(screen.getByRole("heading", { name: "Attendance" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clock In" })).not.toBeNull();
  });

  it("uses an explicit schedule-empty label instead of implying the Crew is working", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.myRoster.mockResolvedValueOnce({ from: "2026-08-13", to: "2026-08-26", today: null, entries: [] });
    render(<CrewMobileApp />);
    expect(await screen.findByText("Schedule not published")).not.toBeNull();
    expect(screen.queryByText("Working", { exact: true })).toBeNull();
  });

  it("shows only the token-bound published roster and opens My Schedule without adding a bottom tab", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    expect((await screen.findAllByText(/10:00\s?(AM|am) – 6:00\s?(PM|pm)/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(screen.getByRole("heading", { name: "My Schedule" })).not.toBeNull();
    expect(screen.getByText(/Hola Hola/)).not.toBeNull();
    expect(screen.getAllByText("OFF").length).toBeGreaterThan(0);
    expect(mocks.myRoster).toHaveBeenCalledWith("crew-token");
  });

  it("synchronizes the seven-day selector with working, OFF, MC and approved-leave schedule states", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.myRoster.mockResolvedValueOnce({
      from: "2026-08-13",
      to: "2026-08-26",
      today: { entry_id: "roster-today", date: "2026-08-13", outlet_id: "outlet-1", outlet_name: "Friends Corner", entry_type: "unpaid_leave", position: "Service Crew", source: "approved_leave" },
      entries: [
        { id: "roster-today", date: "2026-08-13", outlet: { name: "Friends Corner" }, entry_type: "unpaid_leave", position: "Service Crew", source: "approved_leave" },
        { id: "roster-off", date: "2026-08-14", outlet: { name: "Friends Corner" }, entry_type: "off", position: "Service Crew" },
        { id: "roster-mc", date: "2026-08-15", outlet: { name: "Friends Corner" }, entry_type: "medical", position: "Service Crew" },
        { id: "roster-leave", date: "2026-08-16", outlet: { name: "Friends Corner" }, entry_type: "annual_leave", position: "Service Crew", source: "approved_leave" },
        { id: "roster-work", date: "2026-08-17", outlet: { name: "Friends Corner" }, entry_type: "working", start_time: "10:00", end_time: "17:00", break_minutes: 0, position: "Service Crew" },
      ],
    });
    render(<CrewMobileApp />);
    fireEvent.click(await screen.findByRole("button", { name: "View all" }));
    expect(screen.getByRole("heading", { name: "My Schedule" })).not.toBeNull();
    expect(document.querySelector(".crew-schedule-final-day h2").textContent).toBe("Unpaid Leave");
    expect(screen.getAllByText("Annual Leave").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MC").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Monday, 17 August, Working/ }));
    expect(document.querySelector(".crew-schedule-final-day h2").textContent).toMatch(/10:00\s?(AM|am) – 5:00\s?(PM|pm)/);
    expect(document.querySelector(".crew-schedule-final-day").textContent).toContain("7 hrs");
    expect(document.querySelector(".crew-schedule-final-week .is-selected").textContent).toContain("17");
    expect(screen.getByRole("navigation", { name: "Crew navigation" }).querySelector("button.active").textContent).toBe("Home");
    fireEvent.click(screen.getByRole("button", { name: "Jump to today" }));
    expect(document.querySelector(".crew-schedule-final-day h2").textContent).toBe("Unpaid Leave");
  });

  it("opens Today’s Tasks without changing the five-item bottom navigation", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click(await screen.findByRole("button", { name: /Opening & daily tasks/ }));
    expect(screen.getByRole("heading", { name: "Today’s Tasks" })).not.toBeNull();
    expect(screen.getByText("Opening Checklist")).not.toBeNull();
    expect(screen.getByText("Check reservation board")).not.toBeNull();
    expect(mocks.operationsToday).toHaveBeenCalledWith("crew-token");
  });

  it("shows only the signed-in employee's transparent Reward result", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[2]);
    expect(screen.getAllByText("RM 120.72").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Qualified")).not.toBeNull();
    expect(screen.getByText(/235.0h of 730.0h/)).not.toBeNull();
    expect(screen.getAllByText("32.19%").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /View My Performance/ }));
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
    expect(document.body.textContent).not.toContain("Alex");
    expect(mocks.rewardMobile).toHaveBeenCalledWith("crew-token");
  });

  it("shows only the signed-in employee's safe Growth state and no manager controls", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[3]);
    expect(await screen.findByText("Next Milestone")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Taking Orders" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Skills.*See requirements and evidence/ }));
    fireEvent.click(screen.getByRole("button", { name: /Taking Orders/ }));
    expect(screen.getByText("Manager Practical Assessment")).not.toBeNull();
    expect(screen.getByText("Waiting for manager review")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manager note");
    expect(screen.queryByRole("button", { name: /Certify|Submit Assessment/ })).toBeNull();
    expect(mocks.growthMobile).toHaveBeenCalledWith("crew-token");
  });

  it("shows the signed-in employee's safe Performance breakdown", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[3]);
    fireEvent.click(await screen.findByRole("button", { name: /Performance.*monthly score/ }));
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
    expect(screen.getAllByText("87").length).toBeGreaterThan(0);
    expect(screen.getByText("Service Standards")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manager note");
    expect(mocks.performanceMobile).toHaveBeenCalledWith("crew-token");
  });
});
