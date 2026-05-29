import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";
import { isSupabaseUuid } from "./idUtils";
import { enabledActions, getPermissionDefinitions, moduleRegistry, permissionCode } from "../../config/modules.ts";
import { isProtectedRoleName } from "../auth/rbac.js";

const registryPermissionCodes = moduleRegistry.flatMap((module) =>
  enabledActions(module).map((action) => permissionCode(module.id, action)),
);
const registryPermissionCodeSet = new Set(registryPermissionCodes);

const registryModuleLabels = moduleRegistry.map((module) => module.label);

async function syncPermissionCatalog(permissionCodes) {
  const requestedCodes = new Set(permissionCodes);
  const definitions = getPermissionDefinitions()
    .filter((definition) => requestedCodes.has(definition.code))
    .map((definition) => ({
      code: definition.code,
      module: definition.module,
      description: definition.description,
    }));

  if (!definitions.length) return;

  const { error } = await supabase
    .from("permissions")
    .upsert(definitions, { onConflict: "code" });
  throwSupabaseError("roles.permissions_sync", error);
}

function mapRole(row) {
  const isProtectedRole = isProtectedRoleName(row.name);
  const storedPermissions = (row.role_permissions ?? []).map((item) => item.permissions?.code).filter(Boolean);
  const permissions = isProtectedRole ? registryPermissionCodes : storedPermissions;
  const selectedOutletIds = (row.role_outlets ?? []).map((item) => item.outlet_id).filter(Boolean);
  const storedModules = [...new Set((row.role_permissions ?? []).map((item) => item.permissions?.module).filter(Boolean))];
  const modules = isProtectedRole ? registryModuleLabels : storedModules;
  const outletAccessValue = String(row.outlet_access_type || row.outlet_access || "").toLowerCase();
  const outletAccess = ["all", "all_outlets"].includes(outletAccessValue)
    ? "all"
    : selectedOutletIds.length
      ? "selected"
      : "all";
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    is_system_role: Boolean(row.is_system_role),
    is_active: Boolean(row.is_active),
    assignedUsers: Number(row.assigned_users ?? 0),
    outletAccess,
    selectedOutletIds,
    permissions,
    modules,
    updatedAt: row.updated_at || row.created_at || null,
    updatedBy: row.updated_by || "System",
    created_at: row.created_at,
    createdAt: row.created_at,
  };
}

export const roleService = {
  async listRoles() {
    const { data, error } = await supabase
      .from("roles")
      .select(`
        id,name,description,is_system_role,is_active,created_at,
        role_permissions(permission_id,permissions(code,module)),
        role_outlets(outlet_id)
      `)
      .order("name", { ascending: true });

    throwSupabaseError("roles.list", error);

    const { data: employees } = await supabase.from("employees").select("role_id");
    const counts = new Map();
    (employees ?? []).forEach((employee) => {
      if (!employee.role_id) return;
      counts.set(employee.role_id, (counts.get(employee.role_id) ?? 0) + 1);
    });

    return (data ?? []).map((row) => mapRole({ ...row, assigned_users: counts.get(row.id) ?? 0 }));
  },

  async listRoleOptions() {
    const { data, error } = await supabase
      .from("roles")
      .select(`
        id,name,description,is_system_role,is_active,created_at,
        role_outlets(outlet_id)
      `)
      .eq("is_active", true)
      .order("name", { ascending: true });

    throwSupabaseError("roles.options", error);
    return (data ?? []).map((row) => mapRole({ ...row, role_permissions: [] }));
  },

  async saveRole(role) {
    const payload = {
      name: role.name.trim().toLowerCase().replace(/\s+/g, "_"),
      description: role.description ?? "",
      is_system_role: Boolean(role.is_system_role),
      is_active: role.is_active !== false,
    };

    const isUpdate = isSupabaseUuid(role.id);
    const roleQuery = isUpdate
      ? supabase.from("roles").update(payload).eq("id", role.id)
      : supabase.from("roles").insert(payload);

    const { data: savedRole, error: roleError } = await roleQuery
      .select("id,name,description,is_system_role,is_active,created_at")
      .single();

    throwSupabaseError("roles.save", roleError);

    const permissionCodes = [...new Set((role.permissions ?? []).filter((code) => registryPermissionCodeSet.has(code)))];
    await syncPermissionCatalog(permissionCodes);

    const { data: permissions, error: permissionError } = await supabase
      .from("permissions")
      .select("id,code,module")
      .in("code", permissionCodes.length ? permissionCodes : ["__none__"]);

    throwSupabaseError("roles.permissions_lookup", permissionError);

    const foundPermissionCodes = new Set((permissions ?? []).map((permission) => permission.code));
    const missingPermissionCodes = permissionCodes.filter((code) => !foundPermissionCodes.has(code));
    if (missingPermissionCodes.length) {
      throw new Error(`Permission setup is missing: ${missingPermissionCodes.join(", ")}. Please run the latest RBAC setup update.`);
    }

    await supabase.from("role_permissions").delete().eq("role_id", savedRole.id);
    if ((permissions ?? []).length) {
      const { error } = await supabase
        .from("role_permissions")
        .insert(permissions.map((permission) => ({ role_id: savedRole.id, permission_id: permission.id })));
      throwSupabaseError("roles.role_permissions_insert", error);
    }

    await supabase.from("role_outlets").delete().eq("role_id", savedRole.id);
    if (role.outletAccess === "selected" && role.selectedOutletIds?.length) {
      const { error } = await supabase
        .from("role_outlets")
        .insert(role.selectedOutletIds.map((outletId) => ({ role_id: savedRole.id, outlet_id: outletId })));
      throwSupabaseError("roles.role_outlets_insert", error);
    }

    await auditLogService.createAuditLog({
      action: isUpdate ? "role_updated" : "role_created",
      module: "access-control",
      target: savedRole.name,
      description: isUpdate ? "Role updated." : "Role created.",
      after: { ...savedRole, permissions: permissionCodes, outletAccess: role.outletAccess, selectedOutletIds: role.selectedOutletIds ?? [] },
    }).catch(() => {});

    return {
      ...savedRole,
      permissions: permissionCodes,
      modules: [...new Set((permissions ?? []).map((permission) => permission.module))],
      outletAccess: role.outletAccess,
      selectedOutletIds: role.selectedOutletIds ?? [],
      assignedUsers: role.assignedUsers ?? 0,
      updatedAt: new Date().toISOString(),
      updatedBy: "Current User",
    };
  },

  async deleteRole(roleId) {
    const { error } = await supabase.from("roles").delete().eq("id", roleId);
    throwSupabaseError("roles.delete", error);
  },
};
