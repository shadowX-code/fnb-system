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
  updateTaskBlock: vi.fn(),
  completeOperationChecklist: vi.fn(),
  updateDailyTask: vi.fn(),
  sopLibrary: vi.fn(),
  sopVersion: vi.fn(),
  acknowledgeSop: vi.fn(),
  learningAssignment: vi.fn(),
  clock: vi.fn(),
  changePasscode: vi.fn(),
}));

vi.mock("../../../services/crewService.js", () => ({ crewService: mocks }));

import CrewMobileApp from "../CrewMobileApp.jsx";
import i18n from "../../../i18n/index.js";

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
  mocks.operationsToday.mockReset().mockResolvedValue({ outlet: { id: "outlet-1", name: "Friends Corner" }, attendance_context: { on_shift: false }, tasks: [{ id: "ops-1", source: "instance", name: "Opening Checklist", task_type: "checklist", status: "not_started", block_count: 2, completed_count: 0 }, { id: "task-1", source: "legacy_daily", name: "Check reservation board", status: "pending", priority: "normal" }] });
  mocks.myRoster.mockReset().mockResolvedValue({ from: "2026-08-13", to: "2026-08-26", today: { entry_id: "roster-1", date: "2026-08-13", outlet_id: "outlet-1", outlet_name: "Friends Corner", start_time: "10:00", end_time: "18:00", entry_type: "working", position: "Service Crew" }, entries: [{ id: "roster-1", date: "2026-08-13", outlet: { id: "outlet-1", name: "Friends Corner" }, start_time: "10:00", end_time: "18:00", entry_type: "working", position: "Service Crew", template: { code: "MORNING", name: "Morning" } }, { id: "roster-2", date: "2026-08-14", outlet: { id: "outlet-2", name: "Hola Hola" }, entry_type: "off", template: { code: "OFF", name: "OFF" } }] });
  mocks.myLeave.mockReset().mockResolvedValue({ requests: [], upcoming: [] });
  mocks.operationDetail.mockReset().mockResolvedValue({ id: "ops-1", name: "Opening Checklist", task_type: "checklist", status: "not_started", blocks: [{ id: "item-1", title: "Unlock guest entrance", block_type: "checklist_item", required: true, status: "pending" }] });
  mocks.updateOperationItem.mockReset().mockResolvedValue({});
  mocks.updateTaskBlock.mockReset().mockResolvedValue({});
  mocks.completeOperationChecklist.mockReset().mockResolvedValue({});
  mocks.updateDailyTask.mockReset().mockResolvedValue({});
  mocks.sopLibrary.mockReset().mockResolvedValue({ categories: [], sops: [] });
  mocks.sopVersion.mockReset().mockResolvedValue({ id: "sop-version-1", title: "Welcome Standard", category: "Service", version: 2, acknowledgement_required: true, acknowledged: false, summary: "Welcome every guest consistently.", sections: [] });
  mocks.acknowledgeSop.mockReset().mockResolvedValue({ acknowledged: true });
  mocks.learningAssignment.mockReset().mockResolvedValue({ id: "assignment-1", journey: { name: "New Crew Onboarding" }, modules: [] });
  mocks.clock.mockReset().mockResolvedValue({});
  mocks.changePasscode.mockReset().mockResolvedValue({ token: "new-token", expires_at: "2099-08-13T00:00:00Z" });
});

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("Crew Mobile redesign", () => {
  it("changes and persists the Crew system language from Me Settings", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[4]);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Language/ }));
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }));

    expect(await screen.findByRole("heading", { name: "设置" })).not.toBeNull();
    expect(screen.getByRole("navigation", { name: "员工导航" }).textContent).toContain("首页");
    expect(localStorage.getItem("feedx.crew.language")).toBe("zh-CN");
  });

  it("organizes Me as a profile hub with two real quick statuses and grouped navigation", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.myAttendance.mockResolvedValueOnce([
      { id: "attendance-1", clock_in_at: "2026-08-14T02:00:00Z", clock_out_at: "2026-08-14T10:00:00Z", status: "completed" },
      { id: "attendance-2", clock_in_at: "2026-08-13T02:00:00Z", clock_out_at: "2026-08-13T10:00:00Z", status: "completed" },
    ]);
    mocks.myLeave.mockResolvedValueOnce({
      balances: [{ leave_type: "annual", available: 7.5, balance_enforced: true }],
      requests: [{ id: "leave-1", status: "pending" }],
      upcoming: [],
    });
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[4]);

    expect(screen.getByRole("heading", { name: "Me" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "View profile information" }).textContent).toContain("Alex Tan");
    expect(screen.getByRole("region", { name: "Work status summary" }).textContent).toContain("Good");
    expect(screen.getByRole("region", { name: "Work status summary" }).textContent).toContain("7.5");
    expect(screen.getByText("1 Pending")).not.toBeNull();
    expect(screen.getAllByText("Employment Documents")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Work" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Support" })).not.toBeNull();
  });

  it("keeps Me truthful for empty attendance, leave and pending states", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify({ ...session, employee: { ...session.employee, full_name: "A Very Long International Employee Name", nickname: "A" } }));
    mocks.attendanceContext.mockResolvedValueOnce({ outlet_name: "An Exceptionally Long International Restaurant Outlet Name", location_enabled: false });
    mocks.myLeave.mockResolvedValueOnce({ balances: [], requests: [], upcoming: [] });
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[4]);

    expect(screen.getAllByText("No activity yet").length).toBeGreaterThan(0);
    expect(screen.getByText("No balance")).not.toBeNull();
    expect(screen.queryByText(/Pending/)).toBeNull();
    expect(screen.getByRole("button", { name: "View profile information" }).textContent).toContain("A Very Long International Employee Name");
  });

  it("routes Attendance, Leave and Profile from Me and confirms logout", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[4]);
    fireEvent.click(screen.getByRole("button", { name: "View profile information" }));
    expect(screen.getByRole("heading", { name: "Profile Information" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Attendance/ })[0]);
    expect(screen.getByRole("heading", { name: "Attendance" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Me" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Leave/ })[0]);
    expect(screen.getByRole("heading", { name: "My Leave" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    expect(screen.getByRole("dialog", { name: "Log out of FeedX?" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Log out of FeedX?" })).toBeNull();
  });

  it("uses a two-step mobile and custom passcode login that auto-submits four digits", async () => {
    render(<CrewMobileApp />);
    expect(screen.queryByText("Passcode")).toBeNull();
    expect(screen.getByLabelText("FeedX").querySelector("img").getAttribute("src")).toBe("/design-homepage/logo.png");
    expect(screen.queryByText("FeedX Admin sign in")).toBeNull();
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "12 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).not.toBeNull();
    expect(screen.getByText("+60 •••• 6789")).not.toBeNull();
    for (const digit of [1, 2, 3, 4]) fireEvent.click(screen.getByRole("button", { name: String(digit) }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("+6012 345 6789", "1234"));
    expect(await screen.findByText("Alex", { selector: "h1" })).not.toBeNull();
  });

  it("keeps invalid mobile numbers on the first step with a nearby error", () => {
    render(<CrewMobileApp />);
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert").textContent).toBe("Enter a valid mobile number.");
    expect(screen.getByLabelText("Mobile Number").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Welcome back" })).toBeNull();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("keeps authentication errors beside the passcode and supports returning to mobile entry", async () => {
    mocks.signIn.mockRejectedValueOnce(new Error("Incorrect passcode. 2 attempts remaining."));
    render(<CrewMobileApp />);
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "12 345 6789" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    for (const digit of [9, 9, 9, 9]) fireEvent.click(screen.getByRole("button", { name: String(digit) }));
    expect((await screen.findByRole("alert")).textContent).toContain("Incorrect passcode. 2 attempts remaining.");
    expect(screen.getByLabelText("0 of 4 digits entered")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: /Welcome to/ })).not.toBeNull();
    expect(screen.getByLabelText("Mobile Number").value).toBe("12 345 6789");
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
    expect(await screen.findByRole("button", { name: "Clock In" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View Attendance/ }));
    expect(screen.getByRole("heading", { name: "Attendance" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clock In" })).not.toBeNull();
  });

  it("uses an explicit schedule-empty label instead of implying the Crew is working", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.myRoster.mockResolvedValueOnce({ from: "2026-08-13", to: "2026-08-26", today: null, entries: [] });
    render(<CrewMobileApp />);
    expect(await screen.findByText("No published shift today")).not.toBeNull();
    expect(screen.getByText("Not published")).not.toBeNull();
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

  it("opens a Home checklist directly without an intermediate task-list screen", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    render(<CrewMobileApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Opening Checklist" }));
    expect(await screen.findByRole("button", { name: /Unlock guest entrance/ })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Opening Checklist" }).closest(".crew-mobile-detail-header")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Today’s Tasks" })).toBeNull();
    expect(mocks.operationDetail).toHaveBeenCalledWith("crew-token", "ops-1");
    expect(mocks.operationsToday).toHaveBeenCalledWith("crew-token");
  });

  it("refreshes server-derived completion after the final block without a manual Complete Task action", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.operationDetail
      .mockResolvedValueOnce({ id: "ops-1", name: "Opening Checklist", task_type: "checklist", status: "not_started", blocks: [{ id: "item-1", title: "Unlock guest entrance", block_type: "confirmation", required: true, status: "pending" }] })
      .mockResolvedValueOnce({ id: "ops-1", name: "Opening Checklist", task_type: "checklist", status: "completed", completed_at: "2026-08-16T02:30:00Z", blocks: [{ id: "item-1", title: "Unlock guest entrance", block_type: "confirmation", required: true, status: "completed", response: { value: true } }] });

    render(<CrewMobileApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Opening Checklist" }));
    fireEvent.click(await screen.findByRole("button", { name: /Unlock guest entrance/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Unlock guest entrance" }));

    await waitFor(() => expect(mocks.updateTaskBlock).toHaveBeenCalledWith("crew-token", "item-1", "completed", { value: true }, null, null));
    expect(await screen.findByText("Task completed")).not.toBeNull();
    expect(screen.getAllByText(/1 of 1 completed/)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Complete Task" })).toBeNull();
    expect(mocks.completeOperationChecklist).not.toHaveBeenCalled();
  });

  it("uses the shared detail header for long SOP titles while keeping the full title and metadata in the reader", async () => {
    const title = "Customer Complaint Handling & Service Recovery Standard for International Guest Experience";
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.sopLibrary.mockResolvedValueOnce({
      categories: [{ id: "service", name: "Service" }],
      sops: [{ id: "sop-1", version_id: "sop-version-1", title, category: "Service", category_id: "service", version: 3, acknowledgement_required: true, acknowledged: false }],
    });
    mocks.sopVersion.mockResolvedValueOnce({ id: "sop-version-1", title, category: "Service", version: 3, acknowledgement_required: true, acknowledged: false, summary: "Resolve concerns with care.", sections: [] });

    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[1]);
    fireEvent.click(await screen.findByRole("button", { name: `Open ${title}` }));

    const nav = await screen.findByRole("heading", { name: title, level: 1 });
    expect(nav.closest(".crew-mobile-detail-header")).not.toBeNull();
    expect(nav.getAttribute("title")).toBe(title);
    expect(screen.getByRole("button", { name: "Back" }).closest(".crew-mobile-detail-header")).not.toBeNull();
    expect(screen.getByRole("heading", { name: title, level: 2 }).textContent).toBe(title);
    expect(screen.getByLabelText("SOP metadata").textContent).toContain("Service");
    expect(screen.getByLabelText("SOP metadata").textContent).toContain("v3");
    expect(screen.getByLabelText("SOP metadata").textContent).toContain("Acknowledgement required");
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  });

  it("presents an acknowledged SOP as a complete, version-specific status", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.sopLibrary.mockResolvedValueOnce({
      categories: [{ id: "service", name: "Service" }],
      sops: [{ id: "sop-1", version_id: "sop-version-1", title: "Personal Grooming Standard", category: "Service", category_id: "service", version: 2, acknowledgement_required: true, acknowledged: true }],
    });
    mocks.sopVersion.mockResolvedValueOnce({ id: "sop-version-1", title: "Personal Grooming Standard", category: "Service", version: 2, acknowledgement_required: true, acknowledged: true, sections: [] });

    render(<CrewMobileApp />);
    fireEvent.click((await screen.findByRole("navigation", { name: "Crew navigation" })).querySelectorAll("button")[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Open Personal Grooming Standard" }));

    const status = await screen.findByRole("status", { name: "SOP acknowledged" });
    expect(status.textContent).toContain("SOP acknowledged");
    expect(status.textContent).toContain("confirmed version 2");
    expect(screen.queryByRole("button", { name: "I acknowledge this SOP" })).toBeNull();
  });

  it("renders ready, on-shift and completed Home attendance from the existing attendance authority", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    const { unmount } = render(<CrewMobileApp />);
    expect(await screen.findByText("Ready")).not.toBeNull();
    expect(screen.getByText("Ready to clock in")).not.toBeNull();
    expect(document.querySelector(".crew-home-ready-context small").textContent).toContain("Friends Corner");
    expect(document.querySelector(".crew-home-clock-action > span").textContent).toBe("Tap toClock In");
    expect(screen.getByRole("region", { name: "Attendance status" }).classList.contains("is-ready")).toBe(true);
    expect(screen.getByRole("button", { name: "Clock In" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Clock Out" })).toBeNull();
    expect(screen.queryByText("Within area · GPS Verified")).toBeNull();
    unmount();

    mocks.myAttendance.mockResolvedValue([{ id: "open-1", status: "open", clock_in_at: new Date(Date.now() - 65 * 60000).toISOString() }]);
    const openRender = render(<CrewMobileApp />);
    expect(await screen.findByText("On Shift")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Clock Out" })).not.toBeNull();
    expect(document.querySelector(".crew-home-worked").textContent).toMatch(/^01:05:/);
    openRender.unmount();

    const clockIn = new Date();
    const clockOut = new Date();
    mocks.myAttendance.mockResolvedValue([{ id: "done-1", status: "completed", clock_in_at: clockIn.toISOString(), clock_out_at: clockOut.toISOString() }]);
    render(<CrewMobileApp />);
    expect(await screen.findByText("Shift Completed")).not.toBeNull();
    expect(screen.getByText("Worked duration")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Clock Out" })).toBeNull();
  });

  it("keeps geofence exception handling and refreshes Home after successful clock in", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.attendanceContext.mockResolvedValue({ outlet_name: "Friends Corner", location_enabled: true, latitude: 3.1, longitude: 101.7, radius_meters: 100 });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (success) => success({ coords: { latitude: 3.1, longitude: 101.7, accuracy: 8 } }) } });
    mocks.clock.mockResolvedValue({ record: { clock_in_at: "2026-08-14T02:00:00Z" }, outlet: { name: "Friends Corner" } });
    mocks.myAttendance.mockResolvedValueOnce([]).mockResolvedValue([{ id: "open-1", status: "open", clock_in_at: "2026-08-14T02:00:00Z", clock_in_location_verified: true }]);
    render(<CrewMobileApp />);
    expect(await screen.findByText("GPS check at clock-in")).not.toBeNull();
    expect(screen.queryByText("Within area · GPS Verified")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByRole("dialog", { name: "Confirm Clock In" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Confirmed")).not.toBeNull();
    expect(document.querySelector(".crew-home-clock-zone.is-confirmed")).not.toBeNull();
    expect(await screen.findByRole("dialog", { name: "Clocked In Successfully" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go to Home" }));
    expect(await screen.findByText("On Shift")).not.toBeNull();
    expect(screen.getByText("Within area · GPS Verified")).not.toBeNull();
    expect(mocks.clock).toHaveBeenCalledWith("crew-token", "in", expect.objectContaining({ latitude: 3.1 }), "");
  });

  it("shows a persisted geofence exception instead of claiming GPS verification", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.attendanceContext.mockResolvedValue({ outlet_name: "Friends Corner", location_enabled: true, latitude: 3.1, longitude: 101.7, radius_meters: 100 });
    mocks.myAttendance.mockResolvedValue([{ id: "open-exception", status: "open", clock_in_at: "2026-08-14T02:00:00Z", clock_in_location_verified: false, clock_in_location_exception: true }]);
    render(<CrewMobileApp />);
    expect(await screen.findByText("Location exception recorded")).not.toBeNull();
    expect(screen.queryByText("Within area · GPS Verified")).toBeNull();
  });

  it("requires a reason outside the geofence before calling the clock authority", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.attendanceContext.mockResolvedValue({ outlet_name: "Friends Corner", location_enabled: true, latitude: 3.1, longitude: 101.7, radius_meters: 50 });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (success) => success({ coords: { latitude: 3.2, longitude: 101.8, accuracy: 8 } }) } });
    render(<CrewMobileApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Clock In" }));
    expect(await screen.findByText(/from the outlet/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Choose an exception reason/)).not.toBeNull();
    expect(mocks.clock).not.toHaveBeenCalled();
  });

  it("shows true tasks inline, expands locally, and keeps an honest empty state", async () => {
    localStorage.setItem("feedx.crew.session", JSON.stringify(session));
    mocks.operationsToday.mockResolvedValueOnce({ tasks: [{ id: "a", source: "instance", name: "Opening", task_type: "checklist", status: "completed", block_count: 1, completed_count: 1 }, { id: "b", source: "instance", name: "Cleaning", task_type: "checklist", status: "in_progress", block_count: 3, completed_count: 1 }, { id: "c", source: "legacy_daily", name: "Stock shelves", status: "pending" }, { id: "d", source: "legacy_daily", name: "Late check", status: "overdue" }] });
    const first = render(<CrewMobileApp />);
    expect(await screen.findByRole("button", { name: "Open Opening" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open Stock shelves" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open Late check" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show remaining 1 tasks" }));
    expect(screen.getByRole("button", { name: "Open Late check" })).not.toBeNull();
    first.unmount();
    mocks.operationsToday.mockResolvedValue({ tasks: [] });
    render(<CrewMobileApp />);
    expect(await screen.findByText("All clear today")).not.toBeNull();
    expect(screen.queryByText("Keep Growing")).toBeNull();
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
    expect(screen.queryByText("My Path")).toBeNull();
    expect(screen.queryByText("My Certifications")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Growth sections" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /View all skills/ })[0]);
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
    fireEvent.click(await screen.findByRole("button", { name: "View my performance" }));
    expect(screen.getByRole("heading", { name: "My Performance" })).not.toBeNull();
    expect(screen.getAllByText("87").length).toBeGreaterThan(0);
    expect(screen.getByText("Service Standards")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manager note");
    expect(mocks.performanceMobile).toHaveBeenCalledWith("crew-token");
  });
});
