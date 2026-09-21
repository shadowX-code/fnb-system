import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewWorkspacePage from "../CrewWorkspacePage.jsx";
import { CrewAdminOutletProvider } from "../../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../../services/employeeService.js";

vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { crewAccessAdminPage: vi.fn() } }));

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
  ui.notify.mockReset();
});
afterEach(cleanup);

describe("Crew Access outlet read lifecycle", () => {
  it("does not allow a stale Outlet A response to overwrite Outlet B", async () => {
    const outletA = deferred();
    const outletB = deferred();
    employeeService.crewAccessAdminPage
      .mockImplementationOnce(() => outletA.promise)
      .mockImplementationOnce(() => outletB.promise);
    mount();
    await waitFor(() => expect(employeeService.crewAccessAdminPage).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-a", filters: { query: "", employment_status: "all" }, page: 1, pageSize: 20 })));
    fireEvent.click(screen.getByRole("button", { name: "Outlet" }));
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

  it("shows the compact access readiness summary from the existing Crew access read model", async () => {
    employeeService.crewAccessAdminPage.mockResolvedValue(page([
      { id: "active", full_name: "Active Crew", crew_access: { access_state: "active" } },
      { id: "locked", full_name: "Locked Crew", crew_access: { access_state: "locked" } },
      { id: "pending", full_name: "Pending Crew", crew_access: null },
    ], { active: 1, locked: 1, not_enabled: 1 }));
    mount(outlets, "dashboard");

    expect(await screen.findByRole("region", { name: "Crew access readiness" })).not.toBeNull();
    expect(screen.getByText("Active Crew access")).not.toBeNull();
    expect(screen.getByText("Not enabled")).not.toBeNull();
    expect(screen.getByText("Locked")).not.toBeNull();
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
