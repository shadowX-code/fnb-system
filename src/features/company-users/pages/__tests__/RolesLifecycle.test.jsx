import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn() }));
vi.mock("../../../../services/roleService.js", () => ({ roleService: { listRoles: mocks.list, saveRole: mocks.save, deleteRole: mocks.remove } }));

import RolesPage from "../RolesPage.jsx";

const auth = {
  isProtectedRole: true,
  profile: { role_name: "owner", role_id: "owner-role" },
  hasPermission: () => true,
};
const ui = { confirm: vi.fn(), notify: vi.fn() };
const existing = { id: "role-1", name: "operations", description: "Operations", is_system_role: false, is_active: true, outletAccess: "all", selectedOutletIds: [], permissions: [], modules: [], assignedUsers: 0 };
const duplicateSource = {
  ...existing,
  id: "role-source",
  name: "warehouse_operator",
  description: "Warehouse operations",
  outletAccess: "selected",
  selectedOutletIds: ["outlet-1", "outlet-2"],
  permissions: ["dashboard.view", "sales_input.view"],
  modules: ["Dashboard", "Sales Input"],
};

function openRoleActions(index = 0) {
  fireEvent.click(screen.getAllByRole("button", { name: "Role actions" })[index]);
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([existing]);
  mocks.save.mockReset().mockResolvedValue({ ...existing, id: "role-2", name: "dispatch_viewer", description: "Custom company role." });
  mocks.remove.mockReset();
  ui.confirm.mockReset().mockResolvedValue(true);
  ui.notify.mockReset();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#roles");
});

describe("Roles current mounted lifecycle", () => {
  it("creates through the parent-owned save callback, closes only after success, and updates the local listing without a second read", async () => {
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    fireEvent.click(screen.getByRole("button", { name: "Add Role" }));
    fireEvent.change(screen.getByLabelText("Role Name *"), { target: { value: "Dispatch Viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: "dispatch_viewer", outletAccess: "all", selectedOutletIds: [], permissions: [] }));
    await waitFor(() => expect(screen.queryByText("Create Role")).toBeNull());
    expect(screen.getByText("dispatch_viewer")).not.toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Role created successfully." }));
  });

  it("keeps a rejected create open and retryable with the same request ID, without adding an orphan role locally", async () => {
    mocks.save.mockRejectedValueOnce(new Error("trusted save rejected")).mockResolvedValueOnce({ ...existing, id: "role-3", name: "retry_role" });
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    fireEvent.click(screen.getByRole("button", { name: "Add Role" }));
    fireEvent.change(screen.getByLabelText("Role Name *"), { target: { value: "Retry Role" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Create Role")).not.toBeNull();
    expect(screen.queryByText("retry_role")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0].requestId).toBe(mocks.save.mock.calls[0][0].requestId);
    await waitFor(() => expect(screen.getByText("retry_role")).not.toBeNull());
  });

  it("does not expose a create mutation to a user without the create permission", async () => {
    const viewOnly = { isProtectedRole: false, profile: { role_name: "custom", role_id: "role-9" }, hasPermission: () => false };
    render(<RolesPage ui={ui} auth={viewOnly} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    expect(screen.queryByRole("button", { name: "Add Role" })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("navigates catalog actions through full-page role routes and keeps permission selection across category tabs", async () => {
    window.history.replaceState(null, "", "#roles");
    const factoryRole = { ...existing, permissions: ["factory_dashboard.view", "factory_job_orders.view"] };
    mocks.list.mockResolvedValueOnce([factoryRole]);
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");

    fireEvent.click(screen.getByRole("button", { name: "Add Role" }));
    await screen.findByText("Create Role");
    expect(window.location.hash).toBe("#roles/new");
    fireEvent.click(screen.getByRole("button", { name: /back to roles/i }));
    expect(window.location.hash).toBe("#roles");

    fireEvent.click(screen.getByText("operations"));
    await screen.findByText("View Role");
    expect(window.location.hash).toBe("#roles/role-1");
    expect(screen.getByText("Role Information")).not.toBeNull();
    expect(screen.getByText("Summary")).not.toBeNull();
    expect(screen.getAllByText("Audit").some((element) => element.tagName === "DIV")).toBe(true);
    expect(document.querySelector("aside")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Role" }));
    await screen.findByText("Edit Role");
    expect(window.location.hash).toBe("#roles/role-1/edit");
    expect(document.querySelector("aside")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Factory · \d+/ }));
    expect(screen.getByText("Factory")).not.toBeNull();
    expect(screen.getByText("Production Overview")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Off" })[0]);
    fireEvent.click(screen.getByRole("tab", { name: /Restaurant · \d+/ }));
    expect(screen.getByText("Sales Input")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /People & HR · \d+/ }));
    expect(screen.getAllByText("Employees")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /Workforce · \d+/ }));
    expect(screen.getByText("Onboarding Progress")).not.toBeNull();
    expect(screen.getByText("Onboarding")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /System · \d+/ }));
    expect(screen.getByText("Roles & Permissions")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Factory · \d+/ }));
    expect(screen.getAllByRole("button", { name: "Enabled" }).length).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it("edits the existing role through one trusted snapshot and preserves its UUID across a rejected retry", async () => {
    const changed = { ...existing, description: "Updated operations", permissions: ["dashboard.view"], selectedOutletIds: [] };
    mocks.list.mockResolvedValueOnce([{ ...existing, permissions: ["dashboard.view"] }]);
    mocks.save.mockRejectedValueOnce(new Error("edit rejected")).mockResolvedValueOnce(changed);
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    fireEvent.click(screen.getByText("operations"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Role" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Updated operations" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "role-1", description: "Updated operations" }));
    expect(screen.getByText("Edit Role")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0].requestId).toBe(mocks.save.mock.calls[0][0].requestId);
    await waitFor(() => expect(screen.queryByText("Edit Role")).toBeNull());
    expect(screen.getByText("Updated operations")).not.toBeNull();
  });

  it("duplicates through the mounted create editor with copied configuration and one trusted create", async () => {
    const duplicate = { ...duplicateSource, id: "role-duplicate", name: "warehouse_operator_copy" };
    mocks.list.mockResolvedValueOnce([duplicateSource]);
    mocks.save.mockResolvedValueOnce(duplicate);
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [{ id: "outlet-1", name: "Central" }, { id: "outlet-2", name: "North" }] }} />);
    await screen.findByText("warehouse_operator");
    openRoleActions();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Role" }));
    expect(screen.getByText("Create Role")).not.toBeNull();
    expect(screen.getByLabelText("Role Name *").value).toBe("warehouse_operator_copy");
    expect(screen.getByLabelText("Description").value).toBe("Draft copy of warehouse_operator.");
    fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      name: "warehouse_operator_copy",
      permissions: duplicateSource.permissions,
      selectedOutletIds: duplicateSource.selectedOutletIds,
    }));
    expect(mocks.save.mock.calls[0][0].id).toBeUndefined();
    await waitFor(() => expect(screen.queryByText("Create Role")).toBeNull());
    expect(screen.getByText("warehouse_operator_copy")).not.toBeNull();
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Role duplicated" }));
  });

  it("keeps a rejected duplicate open, blocks repeat submit, and retries unchanged intent with the same request ID", async () => {
    const duplicate = { ...duplicateSource, id: "role-duplicate", name: "warehouse_operator_copy" };
    mocks.list.mockResolvedValueOnce([duplicateSource]);
    let rejectDuplicate;
    mocks.save.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectDuplicate = reject; })).mockResolvedValueOnce(duplicate);
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [{ id: "outlet-1", name: "Central" }, { id: "outlet-2", name: "North" }] }} />);
    await screen.findByText("warehouse_operator");
    openRoleActions();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Role" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    rejectDuplicate(new Error("duplicate rejected"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save Role" }).disabled).toBe(false));
    expect(screen.getByText("Create Role")).not.toBeNull();
    expect(screen.queryByText("warehouse_operator_copy")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0].requestId).toBe(mocks.save.mock.calls[0][0].requestId);
    await waitFor(() => expect(screen.getByText("warehouse_operator_copy")).not.toBeNull());
  });

  it("reissues the request ID after a server delegation rejection when the editor changes to a valid snapshot", async () => {
    const saved = { ...existing, description: "Delegation allowed", permissions: ["dashboard.view"] };
    mocks.list.mockResolvedValueOnce([{ ...existing, permissions: ["dashboard.view"] }]);
    mocks.save.mockRejectedValueOnce(new Error("Permission scope restricted")).mockResolvedValueOnce(saved);
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    fireEvent.click(screen.getByText("operations"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Role" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Delegation denied" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Edit Role")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Delegation allowed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0].requestId).not.toBe(mocks.save.mock.calls[0][0].requestId);
    await waitFor(() => expect(screen.getByText("Delegation allowed")).not.toBeNull());
  });

  it("keeps an attempted permission delegation out of local state when the trusted server rejects it", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Permission scope restricted"));
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    fireEvent.click(screen.getByText("operations"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Role" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Off" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].permissions.length).toBeGreaterThan(0);
    expect(screen.getByText("Edit Role")).not.toBeNull();
    expect(screen.queryByText("Role updated")).toBeNull();
    expect(ui.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Role updated" }));
  });

  it("keeps an attempted outlet delegation out of local state when the trusted server rejects it", async () => {
    mocks.list.mockResolvedValueOnce([duplicateSource]);
    mocks.save.mockRejectedValueOnce(new Error("Outlet access restricted"));
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [{ id: "outlet-1", name: "Central" }, { id: "outlet-2", name: "North" }] }} />);
    await screen.findByText("warehouse_operator");
    fireEvent.click(screen.getByText("warehouse_operator"));
    fireEvent.click(screen.getByRole("button", { name: "Edit Role" }));
    fireEvent.click(screen.getByRole("button", { name: "Central" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].selectedOutletIds).toEqual(["outlet-2"]);
    expect(screen.getByText("Edit Role")).not.toBeNull();
    expect(ui.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Role updated" }));
  });

  it("keeps disable confirmation open on trusted failure and closes only after a successful update", async () => {
    const disabled = { ...existing, is_active: false };
    mocks.save.mockRejectedValueOnce(new Error("disable rejected")).mockResolvedValueOnce(disabled);
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("operations");
    openRoleActions();
    fireEvent.click(screen.getByRole("button", { name: "Disable Role" }));
    expect(screen.getByText("Disable Role?")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disable Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Disable Role" }).disabled).toBe(false));
    expect(screen.getByText("Disable Role?")).not.toBeNull();
    expect(ui.notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Role disabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Disable Role?")).toBeNull());
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Role disabled" }));
  });

  it("keeps protected-role disable under the same trusted update authority for an owner actor", async () => {
    mocks.list.mockResolvedValueOnce([{ ...existing, id: "owner-id", name: "owner", is_system_role: true }]);
    mocks.save.mockResolvedValueOnce({ ...existing, id: "owner-id", name: "owner", is_system_role: true, is_active: false });
    render(<RolesPage ui={ui} auth={auth} store={{ outlets: [] }} />);
    await screen.findByText("owner");
    openRoleActions();
    fireEvent.click(screen.getByRole("button", { name: "Disable Role" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable Role" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: "owner-id", is_active: false }));
  });
});
