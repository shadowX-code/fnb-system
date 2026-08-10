import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  employees: { listEmployees: vi.fn(), saveEmployee: vi.fn() },
  positions: { listJobPositions: vi.fn() },
  roles: { listRoleOptions: vi.fn() },
  onboarding: { sendLoginSetupEmail: vi.fn() },
}));

vi.mock("../../../../services/employeeService.js", () => ({ employeeService: mocks.employees }));
vi.mock("../../../../services/jobPositionService.js", () => ({ jobPositionService: mocks.positions }));
vi.mock("../../../../services/roleService.js", () => ({ roleService: mocks.roles }));
vi.mock("../../../../services/employeeAuthOnboardingService.js", () => ({ employeeAuthOnboardingService: mocks.onboarding }));

import UsersPage from "../UsersPage.jsx";

const employee = { id: "employee-1", full_name: "Aisha Rahman", nickname: "Aisha", nationality: "Malaysia", gender: "Female", ic_no: "920416-08-5573", birthday: "1992-04-16", email: "aisha@feedx.test", contact: "60-123456789", role: "Supervisor", role_id: "role-1", position: "Supervisor", workplace: "KL Central", employment_type: "full_time", employment_status: "active", enable_system_login: true, access_state: "active", is_active: true, email_verified: true };

function auth(permissions = []) {
  return { profile: { id: "employee-admin", role_outlet_access_type: "all" }, user: { id: "auth-admin" }, hasPermission: (code) => permissions.includes(code) };
}

function mount(permissions) {
  const ui = { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
  render(<UsersPage ui={ui} store={{ outlets: [{ id: "outlet-1", name: "KL Central", status: "active" }] }} auth={auth(permissions)} />);
  return ui;
}

beforeEach(() => {
  mocks.employees.listEmployees.mockReset().mockResolvedValue([employee]);
  mocks.employees.saveEmployee.mockReset();
  mocks.positions.listJobPositions.mockReset().mockResolvedValue([{ id: "position-1", name: "Supervisor", department: "Operations", status: "active" }]);
  mocks.roles.listRoleOptions.mockReset().mockResolvedValue([{ id: "role-1", name: "Supervisor" }]);
  mocks.onboarding.sendLoginSetupEmail.mockReset();
});

afterEach(cleanup);

describe("Users page employee/auth lifecycle guards", () => {
  it("keeps a view-only employee directory from exposing create, edit, enable, or disable mutations", async () => {
    mount(["employees.view"]);
    await screen.findByText("Aisha");
    expect(screen.queryByRole("button", { name: "Add Employee" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Disable Access")).toBeNull();
    expect(mocks.employees.saveEmployee).not.toHaveBeenCalled();
    expect(mocks.onboarding.sendLoginSetupEmail).not.toHaveBeenCalled();
  });

  it("uses exact employee permissions to expose employee create and login lifecycle actions", async () => {
    mount(["employees.view", "employees.create", "employees.edit", "employees.enable_login", "employees.deactivate", "employees.reset_password"]);
    await screen.findByText("Aisha");
    expect(screen.getByRole("button", { name: "Add Employee" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Disable Access")).toBeTruthy();
  });

  it("keeps a saved employee modal retryable after login onboarding rejects and retries the same employee identity", async () => {
    const pendingEmployee = { ...employee, access_state: "not_sent", email_verified: false, is_active: true };
    mocks.employees.listEmployees.mockResolvedValue([pendingEmployee]);
    mocks.employees.saveEmployee.mockResolvedValue(pendingEmployee);
    mocks.onboarding.sendLoginSetupEmail.mockRejectedValue(new Error("email delivery failed"));
    mount(["employees.view", "employees.edit", "employees.enable_login", "employees.reset_password"]);

    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(screen.getByText("Edit"));
    const submit = await screen.findByRole("button", { name: "Save & Send Login Setup" });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.employees.saveEmployee).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.onboarding.sendLoginSetupEmail).toHaveBeenCalledWith(pendingEmployee.id, { mode: "email" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save & Send Login Setup" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save & Send Login Setup" }));
    await waitFor(() => expect(mocks.employees.saveEmployee).toHaveBeenCalledTimes(2));
    expect(mocks.employees.saveEmployee.mock.calls.map(([value]) => value.id)).toEqual([pendingEmployee.id, pendingEmployee.id]);
    expect(mocks.onboarding.sendLoginSetupEmail.mock.calls.map(([id]) => id)).toEqual([pendingEmployee.id, pendingEmployee.id]);
  });
});
