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
  render(<UsersPage ui={ui} store={{ outlets: [{ id: "outlet-1", name: "KL Central", status: "active" }, { id: "outlet-2", name: "PJ Sentral", status: "active" }] }} auth={auth(permissions)} />);
  return ui;
}

beforeEach(() => {
  mocks.employees.listEmployees.mockReset().mockResolvedValue([employee]);
  mocks.employees.saveEmployee.mockReset();
  mocks.positions.listJobPositions.mockReset().mockResolvedValue([{ id: "position-1", name: "Supervisor", department: "Operations", status: "active" }]);
  mocks.roles.listRoleOptions.mockReset().mockResolvedValue([
    { id: "role-1", name: "Supervisor", outlet_access_type: "all" },
    { id: "role-2", name: "Manager", outlet_access_type: "selected", selected_outlet_ids: ["outlet-2"] },
  ]);
  mocks.onboarding.sendLoginSetupEmail.mockReset().mockResolvedValue({
    auth_user_id: "auth-aisha",
    email: employee.email,
  });
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

  it("uses reset-password authority for active employees and does not expose that action without it", async () => {
    const ui = mount(["employees.view", "employees.reset_password"]);
    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    const reset = screen.getByRole("button", { name: "Send Reset Password Email" });
    fireEvent.click(reset);

    await waitFor(() => expect(mocks.onboarding.sendLoginSetupEmail).toHaveBeenCalledWith(employee.id, { mode: "email" }));
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Reset password email sent." }));

    cleanup();
    mount(["employees.view", "employees.enable_login"]);
    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    expect(screen.queryByRole("button", { name: "Send Reset Password Email" })).toBeNull();
  });

  it.each(["not_sent", "invited"])("uses enable-login authority for %s setup actions", async (accessState) => {
    const pendingEmployee = { ...employee, access_state: accessState, email_verified: false };
    mocks.employees.listEmployees.mockResolvedValue([pendingEmployee]);
    mount(["employees.view", "employees.enable_login"]);

    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Login Setup" }));
    await waitFor(() => expect(mocks.onboarding.sendLoginSetupEmail).toHaveBeenCalledWith(pendingEmployee.id, { mode: "email" }));
  });

  it("does not grant pending login setup from reset-password authority and lets enable-login generate a manual link without roles.edit", async () => {
    const pendingEmployee = { ...employee, access_state: "not_sent", email_verified: false };
    mocks.employees.listEmployees.mockResolvedValue([pendingEmployee]);
    mount(["employees.view", "employees.reset_password"]);

    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    expect(screen.queryByRole("button", { name: "Send Login Setup" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate Setup Link" })).toBeNull();

    cleanup();
    mocks.employees.listEmployees.mockResolvedValue([pendingEmployee]);
    mount(["employees.view", "employees.enable_login"]);
    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Setup Link" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Setup Link" }));

    await waitFor(() => expect(mocks.onboarding.sendLoginSetupEmail).toHaveBeenCalledWith(pendingEmployee.id, { mode: "manual_link" }));
  });

  it("uses reset-password authority for an active employee manual-link fallback without roles.edit", async () => {
    const smtpFailure = Object.assign(new Error("SMTP unavailable"), { canGenerateManualLink: true, code: "SMTP_NOT_CONFIGURED" });
    mocks.onboarding.sendLoginSetupEmail
      .mockRejectedValueOnce(smtpFailure)
      .mockResolvedValueOnce({ auth_user_id: "auth-aisha", email: employee.email, setupUrl: "https://feedx.test/setup" });
    mount(["employees.view", "employees.reset_password"]);

    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Password Email" }));
    await screen.findByRole("button", { name: "Generate Setup Link" });
    fireEvent.click(screen.getByRole("button", { name: "Generate Setup Link" }));

    await waitFor(() => expect(mocks.onboarding.sendLoginSetupEmail).toHaveBeenLastCalledWith(employee.id, { mode: "manual_link" }));
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

  it("allows an active linked employee role to change through the existing employee save authority without changing identity fields", async () => {
    const activeEmployee = { ...employee, auth_user_id: "auth-aisha" };
    const savedEmployee = { ...activeEmployee, role: "Manager", role_id: "role-2" };
    mocks.employees.listEmployees
      .mockResolvedValueOnce([activeEmployee])
      .mockResolvedValueOnce([savedEmployee]);
    mocks.employees.saveEmployee.mockResolvedValue(savedEmployee);
    mount(["employees.view", "employees.edit"]);

    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(screen.getByText("Edit"));

    fireEvent.click(screen.getAllByText("Supervisor").at(-1));
    fireEvent.click(await screen.findByRole("button", { name: "Manager", exact: true }));

    expect(screen.getByText("PJ Sentral")).toBeTruthy();
    expect(screen.getAllByText(employee.email).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Save Employee" }));

    await waitFor(() => expect(mocks.employees.saveEmployee).toHaveBeenCalledTimes(1));
    expect(mocks.employees.saveEmployee).toHaveBeenCalledWith(expect.objectContaining({
      id: activeEmployee.id,
      role: "Manager",
      role_id: "role-2",
      email: activeEmployee.email,
      auth_user_id: activeEmployee.auth_user_id,
    }));
    expect(mocks.onboarding.sendLoginSetupEmail).not.toHaveBeenCalled();
  });

  it("keeps active role assignment read-only for a user without employee edit permission", async () => {
    mount(["employees.view"]);
    await screen.findByText("Aisha");
    fireEvent.click(screen.getByText("Aisha"));

    expect(screen.queryByRole("button", { name: "Edit Employee" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supervisor", exact: true })).toBeNull();
    expect(screen.getAllByText("Supervisor").length).toBeGreaterThan(0);
  });

  it.each(["not_sent", "invited"])("keeps the editable role selector for %s employee access", async (accessState) => {
    const pendingEmployee = { ...employee, access_state: accessState, email_verified: false, auth_user_id: "auth-aisha" };
    mocks.employees.listEmployees.mockResolvedValue([pendingEmployee]);
    mount(["employees.view", "employees.edit"]);

    await screen.findByText("Aisha");
    fireEvent.click(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getAllByText("Supervisor").at(-1));
    fireEvent.click(await screen.findByRole("button", { name: "Manager", exact: true }));

    expect(screen.getByText("PJ Sentral")).toBeTruthy();
  });
});
