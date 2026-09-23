import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewWorkspacePage from "../CrewWorkspacePage.jsx";
import { CREW_ADMIN_OUTLET_STORAGE_KEY, CrewAdminOutletProvider } from "../../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../../services/employeeService.js";
import { crewService } from "../../../../services/crewService.js";

vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { crewAccessAdminPage: vi.fn() } }));
vi.mock("../../../../services/crewService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, crewService: { ...actual.crewService, dashboardAdminData: vi.fn() } };
});

const outlets = [
  { id: "outlet-a", name: "Outlet A", status: "active", is_active: true },
  { id: "outlet-b", name: "Outlet B", status: "active", is_active: true },
];
const auth = { hasPermission: () => true };
const ui = { notify: vi.fn() };
const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
};

function mount(currentOutlets = outlets, initialTab = "employees") {
  return render(<CrewAdminOutletProvider outlets={currentOutlets}><CrewWorkspacePage auth={auth} ui={ui} store={{ outlets: currentOutlets }} initialTab={initialTab} /></CrewAdminOutletProvider>);
}

const page = (rows, summary = {}) => ({ rows, totalCount: rows.length, page: 1, pageSize: 20, summary });

beforeEach(() => {
  localStorage.clear();
  employeeService.crewAccessAdminPage.mockReset();
  crewService.dashboardAdminData.mockReset().mockResolvedValue({ summary: {}, upcoming: [], attention: [] });
  ui.notify.mockReset();
});
afterEach(cleanup);

describe("Crew Access outlet read lifecycle", () => {
  it("uses an explicit Management workplace scope without changing the dashboard outlet", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([{ id: "manager", full_name: "Manager Crew", workplace: "Management", role_outlet_access: { type: "selected", count: 2 }, crew_access: null }]));
    render(<CrewAdminOutletProvider outlets={outlets}><CrewWorkspacePage auth={{ ...auth, profile: { role_outlet_access_type: "all" } }} ui={ui} store={{ outlets }} initialTab="employees" /></CrewAdminOutletProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Workplace" }));
    fireEvent.click(screen.getByRole("button", { name: "Management" }));
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenCalledWith(expect.objectContaining({ outletId: null, filters: { query: "", employment_status: "all", workplace_scope: "management" } })));
    expect(localStorage.getItem(CREW_ADMIN_OUTLET_STORAGE_KEY)).toBe("outlet-a");
    expect(await screen.findByText("2 Outlets")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Workplace" }));
    fireEvent.click(screen.getByRole("button", { name: "Outlet B" }));
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-b", filters: { query: "", employment_status: "all" } })));
    await waitFor(() => expect(localStorage.getItem(CREW_ADMIN_OUTLET_STORAGE_KEY)).toBe("outlet-b"));
  });

  it("does not offer Management scope to outlet-limited Admins", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([]));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Workplace" }));
    expect(screen.queryByRole("button", { name: "Management" })).toBeNull();
  });
  it("shows All and No Outlet Access from the Role read context without offering invalid activation", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([
      { id: "all", full_name: "All Scope Manager", workplace: "Management", role_outlet_access: { type: "all", count: 0 }, crew_access: null },
      { id: "none", full_name: "No Scope Manager", workplace: "Management", role_outlet_access: { type: "none", count: 0 }, crew_access: null },
    ]));
    render(<CrewAdminOutletProvider outlets={outlets}><CrewWorkspacePage auth={{ ...auth, profile: { role_outlet_access_type: "all" } }} ui={ui} store={{ outlets }} initialTab="employees" /></CrewAdminOutletProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Workplace" }));
    fireEvent.click(screen.getByRole("button", { name: "Management" }));
    expect(await screen.findByText("All Outlets")).not.toBeNull();
    expect(screen.getByText("No Outlet Access")).not.toBeNull();
    expect(screen.getByText("No outlet access")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Activate" })).toHaveLength(1);
  });
  it("does not allow a stale Outlet A response to overwrite Outlet B", async () => {
    const outletA = deferred();
    const outletB = deferred();
    employeeService.crewAccessAdminPage
      .mockImplementationOnce(() => outletA.promise)
      .mockImplementationOnce(() => outletB.promise);
    mount();
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-a", filters: { query: "", employment_status: "all" }, page: 1, pageSize: 20 })));
    fireEvent.click(screen.getByRole("button", { name: "Workplace" }));
    fireEvent.click(screen.getByRole("button", { name: "Outlet B" }));
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-b" })));
    outletB.resolve(page([{ id: "b", full_name: "Outlet B Crew", crew_access: null }]));
    expect(await screen.findByText("Outlet B Crew")).not.toBeNull();
    outletA.resolve(page([{ id: "a", full_name: "Outlet A Crew", crew_access: null }]));
    await waitFor(() => expect(screen.queryByText("Outlet A Crew")).toBeNull());
  });

  it("finishes loading without a selected outlet", async () => {
    mount([]);
    await waitFor(() => expect(screen.queryByText("Loading employees…")).toBeNull());
    expect(employeeService.crewAccessAdminPage).not.toHaveBeenCalled();
  });

  it("renders the canonical Intern employment type label", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([{ id: "intern", full_name: "Intern Crew", employment_type: "intern", employment_status: "active", crew_access: null }]));
    mount();

    expect(await screen.findByText("Intern")).not.toBeNull();
    expect(screen.queryByText("intern")).toBeNull();
  });

  it("renders the operational dashboard from its canonical read projection", async () => {
    crewService.dashboardAdminData.mockResolvedValueOnce({
      summary: { scheduled_today: 7, present_today: 6, not_checked_in: 1, attendance_issues: 0, on_leave_today: 1, tasks_total: 3, tasks_completed: 2, tasks_overdue: 1, leave_today: [] },
      upcoming: [
        { type: "birthday", name: "Aina Rahman", position: "Service Crew", date: "2026-09-22", days_until: 1 },
        { type: "leave", name: "Mei Ling", position: "Kitchen Crew", date: "2026-09-25", days_until: 4, leave_type: "annual" },
        { type: "compliance", name: "Rizal Ahmad", position: "Service Crew", requirement_name: "Typhoid Injection", date: "2026-10-04", days_until: 13 },
      ],
      attention: [{ key: "leave_requests", count: 2, title: "Pending leave requests", detail: "New requests need review." }],
      crew_today: [{ employee_id: "crew-a", name: "Aina Rahman", position: "Service Crew", start_time: "10:00:00", end_time: "18:00:00", status: "working", group: "on_duty" }],
      tasks_today: [{ id: "task-a", name: "Opening checklist", assignment: "Service Crew", due_at: null, status: "in_progress" }],
    });
    mount(outlets, "dashboard");

    expect(await screen.findByText("Your Crew Today")).not.toBeNull();
    expect(screen.getByText("Scheduled Today")).not.toBeNull();
    expect(screen.getByText("Attendance")).not.toBeNull();
    expect(screen.getByText("Today's Tasks")).not.toBeNull();
    expect(screen.getByText("Opening checklist")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Opening checklist/i }).getAttribute("href")).toBe("/crew/operations/instances/task-a");
    expect(screen.getByText("1 area needs attention today.")).not.toBeNull();
    expect(screen.getByText("1 Crew has not checked in and 1 task is overdue.")).not.toBeNull();
    expect(screen.getByText("Aina Rahman's birthday")).not.toBeNull();
    expect(screen.getByText("Mei Ling")).not.toBeNull();
    expect(screen.getByText("Rizal Ahmad")).not.toBeNull();
    expect(screen.getByText("Pending leave requests")).not.toBeNull();
    expect(crewService.dashboardAdminData).toHaveBeenCalledWith("outlet-a");
    expect(employeeService.crewAccessAdminPage).not.toHaveBeenCalled();
  });

  it("switches the Dashboard outlet directly without rendering a filter toolbar", async () => {
    crewService.dashboardAdminData.mockResolvedValue({ summary: {}, upcoming: [], attention: [], crew_today: [], tasks_today: [] });
    mount(outlets, "dashboard");
    expect(await screen.findByRole("group", { name: "Dashboard outlet" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Dashboard scope" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Outlet B" }));
    await waitFor(() => expect(crewService.dashboardAdminData).toHaveBeenLastCalledWith("outlet-b"));
  });

  it("keeps an empty Coming Up state inside the compact dashboard surface", async () => {
    crewService.dashboardAdminData.mockResolvedValueOnce({ summary: {}, upcoming: [], attention: [], crew_today: [], tasks_today: [] });
    mount(outlets, "dashboard");

    expect(await screen.findByRole("heading", { name: "Coming Up" })).not.toBeNull();
    expect(screen.getByText("Nothing coming up in the next 30 days.")).not.toBeNull();
  });

  it("shows an explicit failed-read state and retries instead of rendering an empty employee table", async () => {
    employeeService.crewAccessAdminPage.mockRejectedValueOnce(new Error("Crew access unavailable")).mockResolvedValueOnce(page([]));
    mount();

    expect(await screen.findByRole("alert")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenCalledTimes(2));
  });

  it("sends search to the paged Crew Access authority", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([]));
    mount();
    await screen.findByPlaceholderText("Name, position or employee code");
    fireEvent.change(screen.getByPlaceholderText("Name, position or employee code"), { target: { value: "Aina" } });
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { query: "Aina", employment_status: "all" }, page: 1 })));
  });

  it("sends Employment Status to the paged Crew Access authority", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([]));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Employment Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Resigned" }));
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { query: "", employment_status: "resigned" }, page: 1 })));
  });
});
