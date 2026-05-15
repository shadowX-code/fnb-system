import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Eye, MoreHorizontal, Plus, Search, Shield, ShieldAlert, Trash2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import { defaultPermissions, defaultRoles, rolePermissionMatrix } from "../data/rbacDefaults.js";
import { getPermissionGroups, permissionActionLabels, permissionActionOrder } from "../../../../config/modules.ts";
import { roleService } from "../../../services/roleService.js";

const roleMeta = {
  owner: { assignedUsers: 1, outletAccess: "all", selectedOutletIds: [], updatedAt: "2026-05-10", updatedBy: "System" },
  admin: { assignedUsers: 1, outletAccess: "all", selectedOutletIds: [], updatedAt: "2026-05-10", updatedBy: "System" },
  manager: { assignedUsers: 3, outletAccess: "selected", selectedOutletIds: ["jymt-kopitiam", "happiness-ipoh", "hola-ipoh"], updatedAt: "2026-05-09", updatedBy: "Marcus Lee" },
  finance: { assignedUsers: 1, outletAccess: "all", selectedOutletIds: [], updatedAt: "2026-05-07", updatedBy: "Marcus Lee" },
  hr: { assignedUsers: 1, outletAccess: "all", selectedOutletIds: [], updatedAt: "2026-05-07", updatedBy: "Marcus Lee" },
  supervisor: { assignedUsers: 4, outletAccess: "selected", selectedOutletIds: ["friends-corner"], updatedAt: "2026-05-03", updatedBy: "Amanda Tan" },
  purchaser: { assignedUsers: 2, outletAccess: "all", selectedOutletIds: [], updatedAt: "2026-05-03", updatedBy: "Amanda Tan" },
  cashier: { assignedUsers: 8, outletAccess: "selected", selectedOutletIds: ["jymt-kopitiam"], updatedAt: "2026-04-29", updatedBy: "HR" },
  kitchen: { assignedUsers: 6, outletAccess: "selected", selectedOutletIds: ["happiness-ipoh"], updatedAt: "2026-04-29", updatedBy: "HR" },
  staff: { assignedUsers: 12, outletAccess: "selected", selectedOutletIds: ["friends-corner"], updatedAt: "2026-04-25", updatedBy: "System" },
};

const roleEditorGroups = getPermissionGroups();

const roleEditorActions = permissionActionOrder.map((action) => ({
  key: action,
  label: permissionActionLabels[action],
}));

const roleEditorOutlets = [
  { id: "jymt-kopitiam", name: "JYMT Kopitiam" },
  { id: "happiness-ipoh", name: "Happiness Kopitiam Ipoh" },
  { id: "hola-ipoh", name: "Hola Hola Kopitiam Ipoh" },
  { id: "friends-corner", name: "Friends Corner" },
];

function getOutletById(outletId, outlets = roleEditorOutlets) {
  return outlets.find((item) => item.id === outletId);
}

function getRoleSelectedOutlets(role, outlets = roleEditorOutlets) {
  return (role.selectedOutletIds ?? []).map((outletId) => getOutletById(outletId, outlets)).filter(Boolean);
}

function getRoleOutletAccessMode(role) {
  return role.outletAccess === "selected" ? "selected" : "all";
}

function RoleOutletAccessDisplay({ role, compact = false, outlets = roleEditorOutlets }) {
  const outletAccess = getRoleOutletAccessMode(role);
  const selectedOutlets = getRoleSelectedOutlets(role, outlets);

  if (outletAccess === "all") {
    return <span className="text-sm font-semibold text-text-primary">All Outlets</span>;
  }

  return (
    <div className={`flex flex-wrap ${compact ? "max-w-[280px] gap-1" : "gap-1.5"}`}>
      {selectedOutlets.length ? selectedOutlets.map((outlet) => (
        <Badge key={outlet.id} tone="success">{outlet.name}</Badge>
      )) : (
        <Badge tone="warning">No outlets selected</Badge>
      )}
    </div>
  );
}

const roleAssignedUserSamples = [
  { id: "u-owner", role: "owner", fullName: "Marcus Lee", nickname: "Marcus", email: "marcus@hola.test", position: "Owner", workplace: "All Outlets", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-admin", role: "admin", fullName: "Amanda Tan", nickname: "Amanda", email: "amanda@hola.test", position: "Admin", workplace: "HQ", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-manager-1", role: "manager", fullName: "Jason Lim", nickname: "Jason", email: "jason@hola.test", position: "Outlet Manager", workplace: "JYMT Kopitiam", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-manager-2", role: "manager", fullName: "Nur Aina", nickname: "Aina", email: "aina@hola.test", position: "Outlet Manager", workplace: "Happiness Kopitiam Ipoh", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-manager-3", role: "manager", fullName: "Ng Wei Jian", nickname: "Ken", email: "ken@hola.test", position: "Outlet Manager", workplace: "Hola Hola Kopitiam Ipoh", accountStatus: "Invitation Pending", employmentStatus: "Full Time" },
  { id: "u-finance", role: "finance", fullName: "Chloe Wong", nickname: "Chloe", email: "chloe@hola.test", position: "Finance Officer", workplace: "HQ", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-hr", role: "hr", fullName: "Farah Zain", nickname: "Farah", email: "farah@hola.test", position: "HR Officer", workplace: "HQ", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-supervisor-1", role: "supervisor", fullName: "Muhammad Syafiq", nickname: "Syafiq", email: "syafiq@hola.test", position: "Supervisor", workplace: "Friends Corner", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-purchaser", role: "purchaser", fullName: "Ooi Ee-Lyn", nickname: "Ee-Lyn", email: "eelyn@hola.test", position: "Purchaser", workplace: "HQ", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-cashier", role: "cashier", fullName: "Siti Aisyah", nickname: "Siti", email: "siti@hola.test", position: "Cashier", workplace: "JYMT Kopitiam", accountStatus: "Active", employmentStatus: "Part Time" },
  { id: "u-kitchen", role: "kitchen", fullName: "Daniel Koh", nickname: "Daniel", email: "daniel@hola.test", position: "Kitchen Crew", workplace: "Happiness Kopitiam Ipoh", accountStatus: "Active", employmentStatus: "Full Time" },
  { id: "u-staff", role: "staff", fullName: "Aung Min", nickname: "Min", email: "min@hola.test", position: "Service Crew", workplace: "Friends Corner", accountStatus: "Inactive", employmentStatus: "Resigned" },
];

function getRoleEditorModuleCodes(module) {
  return Object.values(module.actions).flatMap((action) => action.codes);
}

function isProtectedRoleName(roleName) {
  return ["owner", "admin"].includes(roleName);
}

function permissionModules(roleName) {
  const codes = rolePermissionMatrix[roleName] ?? [];
  return [...new Set(codes.map((code) => defaultPermissions.find((permission) => permission.code === code)?.module).filter(Boolean))];
}

function enrichRole(role) {
  const meta = roleMeta[role.name] ?? { assignedUsers: 0, outletAccess: "all", selectedOutletIds: [], updatedAt: "Not saved", updatedBy: "-" };
  return {
    ...role,
    ...meta,
    permissions: rolePermissionMatrix[role.name] ?? [],
    modules: permissionModules(role.name),
  };
}

function StatCard({ label, value, helper, tone = "neutral" }) {
  const toneClass = tone === "danger" ? "text-rose-700" : tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-text-primary";
  return (
    <Card className="p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-text-secondary">{helper}</div>
    </Card>
  );
}

function RoleAccessLayout({ title, description, notice, actions, footer, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-primary">Role Management</div>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{title}</h2>
              <p className="mt-1 text-sm text-text-secondary">{description}</p>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <button className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition hover:bg-slate-100 hover:text-text-primary" type="button" aria-label={`Close ${title}`} onClick={onClose}>
                ×
              </button>
            </div>
          </div>
          {notice ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
              {notice}
            </div>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-4">{children}</div>
        <footer className="shrink-0 border-t border-border bg-white px-5 py-3">{footer}</footer>
      </div>
    </div>
  );
}

function RoleEditorModal({ mode = "create", role, onClose, onSubmit, ui, outlets = roleEditorOutlets }) {
  const [errors, setErrors] = useState({});
  const [values, setValues] = useState(() => ({
    name: role?.name ?? "",
    description: role?.description ?? "",
    outletAccess: getRoleOutletAccessMode(role ?? {}),
    selectedOutletIds: role?.selectedOutletIds ?? [],
    is_active: role?.is_active ?? true,
    selectedPermissions: new Set(role?.permissions ?? []),
  }));
  const [hasChanges, setHasChanges] = useState(false);
  const isEdit = mode === "edit";
  const isProtectedRole = isProtectedRoleName(role?.name);

  function markChanged(patch) {
    setValues((current) => ({ ...current, ...patch }));
    setHasChanges(true);
  }

  function cellEnabled(cell) {
    return cell.codes.every((code) => values.selectedPermissions.has(code));
  }

  function toggleOutlet(outletId) {
    if (isProtectedRole) return;
    setErrors((current) => ({ ...current, outletAccess: undefined }));
    setValues((current) => {
      const nextSelected = new Set(current.selectedOutletIds);
      if (nextSelected.has(outletId)) {
        nextSelected.delete(outletId);
      } else {
        nextSelected.add(outletId);
      }
      return { ...current, selectedOutletIds: [...nextSelected] };
    });
    setHasChanges(true);
  }

  function toggleMatrixCell(module, actionKey, cell) {
    if (isProtectedRole) return;
    setValues((current) => {
      const next = new Set(current.selectedPermissions);
      const currentlyEnabled = cell.codes.every((code) => next.has(code));
      const viewCodes = module.actions.view?.codes ?? [];

      if (actionKey === "view" && currentlyEnabled) {
        getRoleEditorModuleCodes(module).forEach((code) => next.delete(code));
      } else if (currentlyEnabled) {
        cell.codes.forEach((code) => next.delete(code));
      } else {
        if (actionKey !== "view") viewCodes.forEach((code) => next.add(code));
        cell.codes.forEach((code) => next.add(code));
      }
      return { ...current, selectedPermissions: next };
    });
    setHasChanges(true);
  }

  const enabledPermissions = [...values.selectedPermissions];
  const activeModuleCount = roleEditorGroups
    .flatMap((group) => group.modules)
    .filter((module) => getRoleEditorModuleCodes(module).some((code) => values.selectedPermissions.has(code))).length;

  function selectedActionCount(module) {
    return Object.values(module.actions).filter((cell) => cell.codes.some((code) => values.selectedPermissions.has(code))).length;
  }

  async function saveRole() {
    if (!values.name.trim()) {
      setErrors({ name: "Role name is required." });
      return;
    }
    if (values.outletAccess === "selected" && values.selectedOutletIds.length === 0) {
      setErrors({ outletAccess: "Select at least one outlet." });
      return;
    }
    if (values.selectedPermissions.size === 0) {
      const confirmed = await ui.confirm({
        title: "Save role with no access?",
        message: "This role has no access. Continue?",
        confirmLabel: isEdit ? "Save Changes" : "Create Role",
      });
      if (!confirmed) return;
    }
    const nextPermissions = [...values.selectedPermissions];
    const modules = [...new Set(nextPermissions.map((code) => defaultPermissions.find((permission) => permission.code === code)?.module).filter(Boolean))];
    onSubmit({
      id: role?.id ?? `role-custom-${crypto.randomUUID()}`,
      name: values.name.trim().toLowerCase().replace(/\s+/g, "_"),
      description: values.description || "Custom company role.",
      is_system_role: role?.is_system_role ?? false,
      is_active: values.is_active,
      assignedUsers: role?.assignedUsers ?? 0,
      outletAccess: values.outletAccess,
      selectedOutletIds: values.selectedOutletIds,
      updatedAt: new Date().toISOString().slice(0, 10),
      updatedBy: "Development Owner",
      permissions: nextPermissions,
      modules,
    });
  }

  return (
    <RoleAccessLayout
      title={isEdit ? "Edit Role" : "Create Role"}
      description="Configure role details and business permissions in one access matrix."
      notice={isProtectedRole ? "Protected role. Owner and admin are reserved by the system." : null}
      onClose={onClose}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold text-text-secondary">
            {hasChanges ? "Unsaved changes" : "No unsaved changes"} · {enabledPermissions.length} permissions enabled
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
              <button className="btn-primary" type="button" disabled={isProtectedRole} onClick={saveRole}>{isEdit ? "Save Changes" : "Save Role"}</button>
          </div>
        </div>
      )}
    >
          <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="space-y-3 xl:sticky xl:top-0 xl:self-start">
              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-3 text-sm font-bold text-text-primary">Role Information</div>
                <div className="space-y-3">
                  <FieldLabel label="Role Name *">
                    <input
                      className={`control h-10 ${errors.name ? "border-rose-200 focus:border-rose-300 focus:ring-rose-50" : ""}`}
                      value={values.name}
                      disabled={isProtectedRole}
                      onChange={(event) => {
                        setErrors((current) => ({ ...current, name: undefined }));
                        markChanged({ name: event.target.value });
                      }}
                      placeholder="e.g. Area Manager"
                    />
                    {errors.name ? <div className="mt-1 text-[11px] font-medium text-rose-600">{errors.name}</div> : null}
                  </FieldLabel>
                  <FieldLabel label="Description">
                    <textarea className="control min-h-20 py-3" value={values.description} disabled={isProtectedRole} onChange={(event) => markChanged({ description: event.target.value })} placeholder="Optional note about what this role can do." />
                  </FieldLabel>
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-text-muted">Outlet Access</div>
                    <div className="grid gap-2">
                      {[
                        {
                          value: "all_outlets",
                          title: "All Outlets",
                          description: "This role can access all outlets.",
                        },
                        {
                          value: "assigned_outlets",
                          title: "Selected Outlets",
                          description: "Choose exactly which outlets this role can access.",
                        },
                      ].map((option) => {
                        const optionValue = option.value === "all_outlets" ? "all" : "selected";
                        const selected = values.outletAccess === optionValue;
                        return (
                          <button
                            key={option.value}
                            className={`rounded-xl border px-3 py-2 text-left transition ${
                              selected
                                ? "border-primary bg-primary/10 text-text-primary"
                                : "border-border bg-surface text-text-secondary hover:border-primary/30 hover:bg-primary/5"
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                            type="button"
                            disabled={isProtectedRole}
                            onClick={() => {
                              setErrors((current) => ({ ...current, outletAccess: undefined }));
                              markChanged({ outletAccess: optionValue });
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`grid h-4 w-4 place-items-center rounded-full border ${selected ? "border-primary bg-primary" : "border-border bg-white"}`}>
                                {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                              </span>
                              <span className="text-sm font-bold">{option.title}</span>
                            </div>
                            <div className="ml-6 mt-0.5 text-[11px] leading-4 text-text-muted">{option.description}</div>
                          </button>
                        );
                      })}
                    </div>
                    {values.outletAccess === "selected" ? (
                      <div className="mt-3">
                        <div className="mb-1 text-[11px] font-semibold text-text-muted">Select outlets</div>
                        <div className="flex flex-wrap gap-2">
                  {outlets.map((outlet) => {
                            const selected = values.selectedOutletIds.includes(outlet.id);
                            return (
                              <button
                                key={outlet.id}
                                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${
                                  selected
                                    ? "border-primary bg-primary text-white shadow-sm"
                                    : "border-border bg-surface text-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                                type="button"
                                disabled={isProtectedRole}
                                onClick={() => toggleOutlet(outlet.id)}
                              >
                                {selected ? <Check size={13} /> : null}
                                {outlet.name}
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-1 text-[11px] text-text-muted">
                          Switching back to All Outlets keeps these selections for later.
                        </div>
                      </div>
                    ) : null}
                    {errors.outletAccess ? <div className="mt-1 text-[11px] font-medium text-rose-600">{errors.outletAccess}</div> : null}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Summary</div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Permissions Enabled</span><strong>{enabledPermissions.length}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Modules Enabled</span><strong>{activeModuleCount}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Assigned Employees</span><strong>{role?.assignedUsers ?? 0}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Last Updated</span><strong className="text-right">{role?.updatedAt ?? "Not saved"}</strong></div>
                </div>
              </section>
            </aside>

            <section className="min-w-0 rounded-2xl border border-border bg-white">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-bold text-text-primary">Permission Matrix</div>
                    <div className="mt-1 text-xs text-text-secondary">
                      {enabledPermissions.length} permissions enabled across {activeModuleCount} modules
                    </div>
                  </div>
                  {hasChanges ? <Badge tone="warning">Unsaved changes</Badge> : null}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1240px] w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr>
                      <th className="sticky left-0 z-20 w-[210px] border-b border-border bg-white px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-text-secondary">Module</th>
                      {roleEditorActions.map((action) => (
                        <th key={action.key} className="border-b border-border px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-text-secondary">{action.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roleEditorGroups.map((group) => (
                      <FragmentLike key={group.label}>
                        <tr>
                          <td colSpan={roleEditorActions.length + 1} className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">{group.label}</td>
                        </tr>
                        {group.modules.map((module) => (
                          <tr key={module.key} className="group">
                            <td className="sticky left-0 z-10 border-b border-border bg-white px-4 py-3 group-hover:bg-slate-50">
                              <div className="text-sm font-bold text-text-primary">{module.label}</div>
                              <div className="mt-1 text-[11px] font-semibold text-text-muted">{selectedActionCount(module)} active actions</div>
                            </td>
                            {roleEditorActions.map((action) => {
                              const cell = module.actions[action.key];
                              if (!cell) {
                                return (
                                  <td key={`${module.key}-${action.key}`} className="border-b border-border px-3 py-3 text-center text-text-muted">—</td>
                                );
                              }
                              const enabled = cellEnabled(cell);
                              return (
                                <td key={`${module.key}-${action.key}`} className="border-b border-border px-2 py-3 text-center">
                                  <button
                                    className={`mx-auto flex min-h-9 w-full max-w-[128px] items-center justify-center rounded-xl border px-2 text-xs font-bold transition ${enabled ? "border-primary bg-primary text-white shadow-sm" : "border-border bg-slate-50 text-text-secondary hover:border-primary/30 hover:bg-primary/5 hover:text-primary"} disabled:cursor-not-allowed disabled:opacity-60`}
                                    type="button"
                                    disabled={isProtectedRole}
                                    title={cell.label}
                                    onClick={() => toggleMatrixCell(module, action.key, cell)}
                                  >
                                    {enabled ? "Enabled" : "Off"}
                                  </button>
                                  <div className="mt-1 text-[10px] font-medium leading-4 text-text-muted">{cell.label}</div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </FragmentLike>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
    </RoleAccessLayout>
  );
}

function FragmentLike({ children }) {
  return children;
}

function getAssignedUsersForRole(role) {
  const directUsers = roleAssignedUserSamples.filter((user) => user.role === role.name);
  if (directUsers.length >= role.assignedUsers) return directUsers.slice(0, role.assignedUsers);
  const fallbackUsers = roleAssignedUserSamples.filter((user) => user.role !== role.name);
  return [...directUsers, ...fallbackUsers].slice(0, role.assignedUsers);
}

function AddRoleModal({ onClose, onSubmit, ui, outlets }) {
  function submitRole(role) {
    onSubmit({
      ...role,
      assignedUsers: 0,
    });
  }
  return (
    <RoleEditorModal mode="create" onClose={onClose} onSubmit={submitRole} ui={ui} outlets={outlets} />
  );
}

function RoleDetailModal({ role, onClose, onEditRole, outlets }) {
  const [assignedUsersOpen, setAssignedUsersOpen] = useState(false);
  const [assignedUserSearch, setAssignedUserSearch] = useState("");
  const permissions = new Set(role.permissions ?? []);
  const isProtectedRole = ["owner", "admin"].includes(role.name);
  const assignedUsers = getAssignedUsersForRole(role);
  const filteredAssignedUsers = assignedUsers.filter((user) => {
    const query = assignedUserSearch.trim().toLowerCase();
    if (!query) return true;
    return [user.fullName, user.nickname, user.email, user.position, user.workplace, user.accountStatus, user.employmentStatus]
      .some((value) => value.toLowerCase().includes(query));
  });
  const activeModuleCount = roleEditorGroups
    .flatMap((group) => group.modules)
    .filter((module) => getRoleEditorModuleCodes(module).some((code) => permissions.has(code))).length;

  function readonlyCellEnabled(cell) {
    return cell.codes.every((code) => permissions.has(code));
  }

  function selectedActionCount(module) {
    return Object.values(module.actions).filter((cell) => cell.codes.some((code) => permissions.has(code))).length;
  }

  return (
    <RoleAccessLayout
      title="View Role"
      description={`${role.name} · ${role.description}`}
      notice={isProtectedRole ? "Protected role. Owner and admin are reserved by the system and cannot be edited directly." : null}
      onClose={onClose}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold text-text-secondary">Read-only role view · {permissions.size} permissions enabled</div>
          <div className="flex gap-2">
            <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
            {isProtectedRole ? (
              <button className="btn-primary cursor-not-allowed opacity-60" type="button" disabled title="Protected roles cannot be edited.">Edit Role</button>
            ) : (
              <button className="btn-primary" type="button" onClick={onEditRole}>Edit Role</button>
            )}
          </div>
        </div>
      )}
    >
          <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
            <aside className="space-y-3 xl:sticky xl:top-0 xl:self-start">
              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-3 text-sm font-bold text-text-primary">Role Information</div>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Role Name</div>
                    <div className="mt-1 flex items-center gap-2 font-semibold text-text-primary">
                      {role.name}
                      <Badge tone={isProtectedRole ? "warning" : "neutral"}>{isProtectedRole ? "Protected" : "Custom"}</Badge>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Description</div>
                    <div className="mt-1 text-text-secondary">{role.description || "No description added."}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Outlet Access</div>
                    <div className="mt-2"><RoleOutletAccessDisplay role={role} outlets={outlets} /></div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Summary</div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Permissions enabled</span><strong>{permissions.size}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Modules with access</span><strong>{activeModuleCount}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Assigned employees</span><button className="font-bold text-primary underline-offset-2 hover:underline" type="button" onClick={() => setAssignedUsersOpen(true)}>{role.assignedUsers}</button></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-text-secondary">Last updated</span><strong>{role.updatedAt}</strong></div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Audit</div>
                <div className="mt-3 space-y-2 text-sm text-text-secondary">
                  <div className="flex items-center justify-between gap-3"><span>Created by</span><strong className="text-text-primary">{isProtectedRole ? "System" : "Development Owner"}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span>Created date</span><strong className="text-text-primary">{isProtectedRole ? "2026-05-01" : role.updatedAt}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span>Last updated by</span><strong className="text-text-primary">{role.updatedBy}</strong></div>
                  <div className="flex items-center justify-between gap-3"><span>Last updated date</span><strong className="text-text-primary">{role.updatedAt}</strong></div>
                </div>
              </section>
            </aside>

            <section className="min-w-0 rounded-2xl border border-border bg-white">
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-bold text-text-primary">Permission Matrix</div>
                    <div className="mt-1 text-xs text-text-secondary">Read-only access map for this role.</div>
                  </div>
                  <div className="text-xs font-semibold text-text-secondary">{permissions.size} permissions · {activeModuleCount} modules</div>
                </div>
              </div>

                <div className="overflow-x-auto">
                  <table className="min-w-[1240px] w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr>
                        <th className="sticky left-0 z-20 w-[210px] border-b border-border bg-white px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-text-secondary">Module</th>
                        {roleEditorActions.map((action) => (
                          <th key={action.key} className="border-b border-border px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-text-secondary">{action.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {roleEditorGroups.map((group) => (
                        <FragmentLike key={group.label}>
                          <tr>
                            <td colSpan={roleEditorActions.length + 1} className="bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">{group.label}</td>
                          </tr>
                          {group.modules.map((module) => (
                            <tr key={module.key}>
                              <td className="sticky left-0 z-10 border-b border-border bg-white px-4 py-3">
                                <div className="text-sm font-bold text-text-primary">{module.label}</div>
                                <div className="mt-1 text-[11px] font-semibold text-text-muted">{selectedActionCount(module)} active actions</div>
                              </td>
                              {roleEditorActions.map((action) => {
                                const cell = module.actions[action.key];
                                if (!cell) {
                                  return <td key={`${module.key}-${action.key}`} className="border-b border-border px-3 py-3 text-center text-text-muted">—</td>;
                                }
                                const enabled = readonlyCellEnabled(cell);
                                return (
                                  <td key={`${module.key}-${action.key}`} className="border-b border-border px-2 py-3 text-center">
                                    <div
                                      className={`mx-auto flex min-h-9 w-full max-w-[128px] items-center justify-center rounded-xl border px-2 text-xs font-bold ${
                                        enabled ? "border-primary bg-primary text-white shadow-sm" : "border-border bg-slate-50 text-text-muted opacity-70"
                                      }`}
                                      title={cell.label}
                                    >
                                      {enabled ? "Enabled" : "Off"}
                                    </div>
                                    <div className="mt-1 text-[10px] font-medium leading-4 text-text-muted">{cell.label}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </FragmentLike>
                      ))}
                    </tbody>
                  </table>
                </div>
            </section>
          </div>
          {assignedUsersOpen ? (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true">
              <div className="flex max-h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-2xl">
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-primary">Assigned Employees</div>
                    <h3 className="mt-1 text-lg font-semibold text-text-primary">{role.name}</h3>
                    <p className="mt-1 text-sm text-text-secondary">Employees currently assigned to this role.</p>
                  </div>
                  <button className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition hover:bg-slate-100 hover:text-text-primary" type="button" onClick={() => setAssignedUsersOpen(false)} aria-label="Close assigned employees">
                    ×
                  </button>
                </header>
                <div className="border-b border-border px-5 py-3">
                  <div className="relative max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
                    <input className="control h-10 w-full pl-9" value={assignedUserSearch} onChange={(event) => setAssignedUserSearch(event.target.value)} placeholder="Search assigned employees..." />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="table-head">
                      <tr>
                        <th className="px-4 py-3 text-left">Employee</th>
                        <th className="px-4 py-3 text-left">Position</th>
                        <th className="px-4 py-3 text-left">Work Place</th>
                        <th className="px-4 py-3 text-left">Account</th>
                        <th className="px-4 py-3 text-left">Employment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssignedUsers.map((user) => (
                        <tr key={user.id} className="border-b border-border hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-bold text-text-primary">{user.fullName} <span className="font-semibold text-text-muted">({user.nickname})</span></div>
                            <div className="mt-1 text-xs text-text-secondary">{user.email}</div>
                          </td>
                          <td className="px-4 py-3 text-text-secondary">{user.position}</td>
                          <td className="px-4 py-3 text-text-secondary">{user.workplace}</td>
                          <td className="px-4 py-3"><Badge tone={user.accountStatus === "Active" ? "success" : user.accountStatus === "Inactive" ? "neutral" : "warning"}>{user.accountStatus}</Badge></td>
                          <td className="px-4 py-3"><Badge tone={user.employmentStatus === "Full Time" ? "success" : user.employmentStatus === "Part Time" ? "info" : "neutral"}>{user.employmentStatus}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredAssignedUsers.length ? (
                    <div className="p-8 text-center">
                      <div className="text-sm font-bold text-text-primary">No assigned users found.</div>
                      <p className="mt-1 text-sm text-text-secondary">Try another search term.</p>
                    </div>
                  ) : null}
                </div>
                <footer className="shrink-0 border-t border-border px-5 py-3 text-right">
                  <button className="btn-secondary" type="button" onClick={() => setAssignedUsersOpen(false)}>Close</button>
                </footer>
              </div>
            </div>
          ) : null}
    </RoleAccessLayout>
  );
}

export default function RolesPage({ ui, store }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState(null);
  const [actionMenuRoleId, setActionMenuRoleId] = useState(null);
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [disableRoleRequest, setDisableRoleRequest] = useState(null);
  const editorOutlets = useMemo(
    () => (store?.outlets?.length ? store.outlets.map((outlet) => ({ id: outlet.id, name: outlet.name })) : roleEditorOutlets),
    [store?.outlets],
  );

  useEffect(() => {
    let ignore = false;
    async function loadRoles() {
      setLoading(true);
      setLoadError("");
      try {
        const rows = await roleService.listRoles();
        if (!ignore) setRoles(rows);
      } catch (error) {
        console.error("Unable to load roles", error);
        if (!ignore) setLoadError(error.message || "Unable to load roles.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadRoles();
    return () => {
      ignore = true;
    };
  }, []);

  const filteredRoles = useMemo(() => {
    const search = query.trim().toLowerCase();
    return roles.filter((role) => {
      const outletNames = getRoleOutletAccessMode(role) === "all"
        ? ["All Outlets"]
        : getRoleSelectedOutlets(role, editorOutlets).map((outlet) => outlet.name);
      return !search || [role.name, role.description, ...outletNames].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [query, roles]);

  const protectedRoles = roles.filter((role) => isProtectedRoleName(role.name));
  const customRoles = roles.filter((role) => !isProtectedRoleName(role.name));
  const assignedUserCount = roles.reduce((sum, role) => sum + Number(role.assignedUsers || 0), 0);

  function roleAction(title, role) {
    ui.notify({ title, message: role.name });
    setActionMenuRoleId(null);
  }

  async function addRole(role) {
    try {
      const saved = await roleService.saveRole(role);
      setRoles((current) => [saved, ...current]);
      setAddRoleOpen(false);
      ui.notify({ title: "Role created successfully.", message: saved.name });
    } catch (error) {
      console.error("Unable to create role", error);
      ui.notify({ title: "Unable to create role", message: error.message || "Please try again.", tone: "error" });
    }
  }

  async function saveRoleEdits(patch) {
    try {
      const saved = await roleService.saveRole(patch);
      setRoles((current) => current.map((role) => (role.id === saved.id ? { ...role, ...saved } : role)));
      setEditRole(null);
      ui.notify({ title: "Role updated", message: saved.name });
    } catch (error) {
      console.error("Unable to update role", error);
      ui.notify({ title: "Unable to update role", message: error.message || "Please try again.", tone: "error" });
    }
  }

  function disableRole(role) {
    setDisableRoleRequest(role);
    setActionMenuRoleId(null);
  }

  function confirmDisableRole() {
    const role = disableRoleRequest;
    if (!role) return;
    saveRoleEdits({ ...role, is_active: false });
    setActionMenuRoleId(null);
    setDisableRoleRequest(null);
    ui.notify({ title: "Role disabled", message: role.name });
  }

  function deleteRole(role) {
    if (isProtectedRoleName(role.name)) {
      ui.notify({ title: "Protected role", message: "Owner and admin roles cannot be deleted.", tone: "error" });
      return;
    }
    roleService.deleteRole(role.id).then(() => {
      setRoles((current) => current.filter((item) => item.id !== role.id));
      setActionMenuRoleId(null);
      ui.notify({ title: "Role deleted", message: role.name });
    }).catch((error) => {
      console.error("Unable to delete role", error);
      ui.notify({ title: "Unable to delete role", message: error.message || "Please try again.", tone: "error" });
    });
  }

  function duplicateRole(role) {
    const duplicate = {
      ...role,
      id: `role-custom-${crypto.randomUUID()}`,
      name: `${role.name}_copy`,
      description: `Draft copy of ${role.name}.`,
      is_system_role: false,
      is_active: true,
      assignedUsers: 0,
      updatedAt: new Date().toISOString().slice(0, 10),
      updatedBy: "Development Owner",
    };
    roleService.saveRole(duplicate).then((saved) => {
      setRoles((current) => [saved, ...current]);
      setActionMenuRoleId(null);
      setEditRole(saved);
      ui.notify({ title: "Role duplicated", message: `${saved.name} created as editable draft.` });
    }).catch((error) => {
      console.error("Unable to duplicate role", error);
      ui.notify({ title: "Unable to duplicate role", message: error.message || "Please try again.", tone: "error" });
    });
  }

  function toggleRolePermission(roleId, code) {
    setRoles((current) =>
      current.map((role) => {
        if (role.id !== roleId) return role;
        const permissions = new Set(role.permissions);
        if (permissions.has(code)) permissions.delete(code);
        else permissions.add(code);
        const modules = [...new Set([...permissions].map((permissionCode) => defaultPermissions.find((permission) => permission.code === permissionCode)?.module).filter(Boolean))];
        return {
          ...role,
          permissions: [...permissions],
          modules,
          updatedAt: new Date().toISOString().slice(0, 10),
          updatedBy: "Development Owner",
        };
      }),
    );
    setSelectedRole((current) => {
      if (!current || current.id !== roleId) return current;
      const permissions = new Set(current.permissions);
      if (permissions.has(code)) permissions.delete(code);
      else permissions.add(code);
      const modules = [...new Set([...permissions].map((permissionCode) => defaultPermissions.find((permission) => permission.code === permissionCode)?.module).filter(Boolean))];
      return {
        ...current,
        permissions: [...permissions],
        modules,
        updatedAt: new Date().toISOString().slice(0, 10),
        updatedBy: "Development Owner",
      };
    });
  }

  function saveRolePermissions(roleId, nextPermissions) {
    const modules = [...new Set(nextPermissions.map((permissionCode) => defaultPermissions.find((permission) => permission.code === permissionCode)?.module).filter(Boolean))];
    setRoles((current) =>
      current.map((role) =>
        role.id === roleId
          ? {
              ...role,
              permissions: nextPermissions,
              modules,
              updatedAt: new Date().toISOString().slice(0, 10),
              updatedBy: "Development Owner",
            }
          : role,
      ),
    );
    setSelectedRole((current) =>
      current?.id === roleId
        ? {
            ...current,
            permissions: nextPermissions,
            modules,
            updatedAt: new Date().toISOString().slice(0, 10),
            updatedBy: "Development Owner",
          }
        : current,
    );
    ui.notify({ title: "Permissions saved", message: `${nextPermissions.length} permissions active.` });
  }

  const columns = [
    {
      key: "role",
      header: "Role",
      sticky: true,
      width: "240px",
      render: (row) => (
        <button className="max-w-[220px] text-left" type="button" onClick={(event) => { event.stopPropagation(); setSelectedRole(row); }}>
          <div className="truncate text-sm font-bold text-text-primary">{row.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={isProtectedRoleName(row.name) ? "warning" : "neutral"}>{isProtectedRoleName(row.name) ? "Protected" : "Custom"}</Badge>
          </div>
        </button>
      ),
    },
    { key: "description", header: "Description", render: (row) => <span className="text-sm text-text-secondary">{row.description}</span> },
    { key: "outletAccess", header: "Outlet Access", render: (row) => <RoleOutletAccessDisplay role={row} compact outlets={editorOutlets} /> },
    { key: "assignedUsers", header: "Assigned Employees", align: "right" },
    {
      key: "coverage",
      header: "Accessible Modules",
      render: (row) => (
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {row.modules.slice(0, 4).map((module) => <Badge key={module} tone="neutral">{module}</Badge>)}
          {row.modules.length > 4 ? <Badge tone="info">+{row.modules.length - 4} more</Badge> : null}
          {!row.modules.length ? <span className="text-xs text-text-muted">No permissions</span> : null}
        </div>
      ),
    },
    { key: "updatedAt", header: "Last Updated", render: (row) => <span className="text-xs text-text-secondary">{row.updatedAt}</span> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      width: "72px",
      render: (row) => (
        <div className="relative flex justify-end" onClick={(event) => event.stopPropagation()}>
          <button className="icon-btn" type="button" onClick={() => setActionMenuRoleId((value) => (value === row.id ? null : row.id))}>
            <MoreHorizontal size={15} />
          </button>
          {actionMenuRoleId === row.id ? (
            <div className="absolute right-0 top-9 z-50 w-52 rounded-2xl border border-border bg-white p-1.5 text-sm shadow-xl">
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { setSelectedRole(row); setActionMenuRoleId(null); }}>
                <Eye size={14} /> View Permissions
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { setEditRole(row); setActionMenuRoleId(null); }}>
                <Shield size={14} /> Edit Role
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => duplicateRole(row)}>
                <Copy size={14} /> Duplicate Role
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-amber-700 hover:bg-amber-50" type="button" onClick={() => disableRole(row)}>
                <ShieldAlert size={14} /> Disable Role
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={isProtectedRoleName(row.name)} type="button" onClick={() => deleteRole(row)}>
                <Trash2 size={14} /> Delete Role
              </button>
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="System"
        title="Roles"
        description="Company-wide access roles for operations, HR, finance, reports, and future systems."
        actions={<button className="btn-primary" type="button" onClick={() => setAddRoleOpen(true)}><Plus size={16} /> Add Role</button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Roles" value={roles.length} helper="All active and inactive roles" />
        <StatCard label="Protected Roles" value={protectedRoles.length} helper="Owner and admin only" tone="warning" />
        <StatCard label="Custom Roles" value={customRoles.length} helper="Editable company roles" />
        <StatCard label="Assigned Employees" value={assignedUserCount} helper="Employees linked to roles" />
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <strong>System note:</strong> Roles define access permissions across operational modules, HR tools, reports, and future company systems.
      </div>

      <FilterBar compact>
        <FieldLabel label="Search Role">
          <input className="control h-9 min-w-[260px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search role or outlet..." />
        </FieldLabel>
      </FilterBar>

      <Card title="Role Catalog" description="Rows summarize outlet access, assigned employees, and accessible modules.">
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading roles...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{loadError}</div>
        ) : filteredRoles.length ? (
          <DataTable columns={columns} rows={filteredRoles} getRowKey={(row) => row.id} onRowClick={(row) => setSelectedRole(row)} tableClassName="min-w-[1180px]" />
        ) : (
          <div className="p-8 text-center">
            <div className="text-sm font-bold text-text-primary">No custom roles created yet.</div>
            <p className="mt-1 text-sm text-text-secondary">Adjust filters or create your first custom role.</p>
          </div>
        )}
      </Card>

      <div className="rounded-2xl border border-border bg-white px-4 py-3 text-xs text-text-secondary">
        Permissions will expand automatically as new HR, KPI, payroll, and operational modules are added.
      </div>

      {selectedRole ? (
        <RoleDetailModal
          role={selectedRole}
          onClose={() => setSelectedRole(null)}
          onEditRole={() => {
            setEditRole(selectedRole);
            setSelectedRole(null);
          }}
          outlets={editorOutlets}
        />
      ) : null}

      {addRoleOpen ? <AddRoleModal ui={ui} onClose={() => setAddRoleOpen(false)} onSubmit={addRole} outlets={editorOutlets} /> : null}
      {editRole ? (
        <RoleEditorModal
          mode="edit"
          role={editRole}
          onClose={() => setEditRole(null)}
          onSubmit={saveRoleEdits}
          ui={ui}
          outlets={editorOutlets}
        />
      ) : null}
      {disableRoleRequest ? (
        <Modal
          title="Disable Role?"
          description="Employees assigned to this role may lose access."
          onClose={() => setDisableRoleRequest(null)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setDisableRoleRequest(null)}>Cancel</button>
              <button className="btn-primary bg-amber-600 hover:bg-amber-700" type="button" onClick={confirmDisableRole}>Disable Role</button>
            </>
          }
        >
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-bold">{disableRoleRequest.name}</div>
            <p className="mt-1 text-xs leading-5">{disableRoleRequest.assignedUsers} employees are currently assigned to this role. Review employee access before disabling.</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
