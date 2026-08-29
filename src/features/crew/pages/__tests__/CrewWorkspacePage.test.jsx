import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CrewWorkspacePage from "../CrewWorkspacePage.jsx";
import { CrewAdminOutletProvider } from "../../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../../services/employeeService.js";

vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { listCrewAccessEmployees: vi.fn() } }));

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

function mount(currentOutlets = outlets) {
  return render(<CrewAdminOutletProvider outlets={currentOutlets}><CrewWorkspacePage auth={auth} ui={ui} store={{ outlets: currentOutlets }} initialTab="employees" /></CrewAdminOutletProvider>);
}

beforeEach(() => {
  localStorage.clear();
  employeeService.listCrewAccessEmployees.mockReset();
  ui.notify.mockReset();
});
afterEach(cleanup);

describe("Crew Access outlet read lifecycle", () => {
  it("does not allow a stale Outlet A response to overwrite Outlet B", async () => {
    const outletA = deferred();
    const outletB = deferred();
    employeeService.listCrewAccessEmployees
      .mockImplementationOnce(() => outletA.promise)
      .mockImplementationOnce(() => outletB.promise);
    mount();
    await waitFor(() => expect(employeeService.listCrewAccessEmployees).toHaveBeenCalledWith("outlet-a"));
    fireEvent.click(screen.getByRole("button", { name: "Outlet" }));
    fireEvent.click(screen.getByRole("button", { name: "Outlet B" }));
    await waitFor(() => expect(employeeService.listCrewAccessEmployees).toHaveBeenCalledWith("outlet-b"));
    outletB.resolve([{ id: "b", full_name: "Outlet B Crew", crew_access: null }]);
    expect(await screen.findByText("Outlet B Crew")).not.toBeNull();
    outletA.resolve([{ id: "a", full_name: "Outlet A Crew", crew_access: null }]);
    await waitFor(() => expect(screen.queryByText("Outlet A Crew")).toBeNull());
  });

  it("finishes loading without a selected outlet", async () => {
    mount([]);
    await waitFor(() => expect(screen.queryByText("Loading employees…")).toBeNull());
    expect(employeeService.listCrewAccessEmployees).not.toHaveBeenCalled();
  });

  it("renders the canonical Intern employment type label", async () => {
    employeeService.listCrewAccessEmployees.mockResolvedValue([{ id: "intern", full_name: "Intern Crew", employment_type: "intern", employment_status: "active", crew_access: null }]);
    mount();

    expect(await screen.findByText("Intern")).not.toBeNull();
    expect(screen.queryByText("intern")).toBeNull();
  });
});
