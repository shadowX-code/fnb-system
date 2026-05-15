import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { defaultPermissions, defaultRoles, rolePermissionMatrix } from "../data/rbacDefaults.js";

export default function RolePermissionAssignmentPage({ ui }) {
  const [selectedRole, setSelectedRole] = useState("manager");
  const [selectedPermissions, setSelectedPermissions] = useState(() => new Set(rolePermissionMatrix.manager ?? []));
  const groupedPermissions = useMemo(
    () =>
      defaultPermissions.reduce((groups, permission) => {
        const items = groups.get(permission.module) ?? [];
        items.push(permission);
        groups.set(permission.module, items);
        return groups;
      }, new Map()),
    [],
  );

  function selectRole(roleName) {
    setSelectedRole(roleName);
    setSelectedPermissions(new Set(rolePermissionMatrix[roleName] ?? []));
  }

  function togglePermission(code) {
    setSelectedPermissions((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="System"
        title="Role Permission Assignment"
        description="Assign permissions by role. Saved values will write to role_permissions."
        actions={<button className="btn-primary" type="button" onClick={() => ui.notify({ title: "Permissions saved", message: `${selectedPermissions.size} permissions selected for ${selectedRole}.` })}><Save size={16} /> Save</button>}
      />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card title="Roles" description="Select one role to configure.">
          <div className="space-y-1 p-2">
            {defaultRoles.map((role) => (
              <button
                key={role.id}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${selectedRole === role.name ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"}`}
                type="button"
                onClick={() => selectRole(role.name)}
              >
                <span>{role.name}</span>
                <Badge tone={role.is_system_role ? "info" : "neutral"}>{role.is_system_role ? "System" : "Custom"}</Badge>
              </button>
            ))}
          </div>
        </Card>
        <Card title="Permissions" description="Grouped by FeedX module.">
          <div className="grid gap-3 p-3 md:grid-cols-2">
            {[...groupedPermissions.entries()].map(([module, permissions]) => (
              <section key={module} className="rounded-2xl border border-border bg-white p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">{module}</div>
                <div className="space-y-2">
                  {permissions.map((permission) => (
                    <label key={permission.code} className="flex cursor-pointer items-start gap-2 rounded-xl px-2 py-1.5 transition hover:bg-slate-50">
                      <input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={selectedPermissions.has(permission.code)} onChange={() => togglePermission(permission.code)} />
                      <span>
                        <span className="block text-sm font-semibold text-text-primary">{permission.code}</span>
                        <span className="block text-xs text-text-secondary">{permission.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
