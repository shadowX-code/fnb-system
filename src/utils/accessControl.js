const permissionAliases = {
  "roles_permissions.view": ["roles.view"],
  "roles_permissions.create": ["roles.create"],
  "roles_permissions.edit": ["roles.edit"],
  "roles_permissions.delete": ["roles.delete"],
  "roles.view": ["roles_permissions.view"],
  "roles.create": ["roles_permissions.create"],
  "roles.edit": ["roles_permissions.edit"],
  "roles.delete": ["roles_permissions.delete"],
};

export function hasPermission(auth, code) {
  if (auth?.hasPermission?.(code)) return true;
  return (permissionAliases[code] ?? []).some((alias) => auth?.hasPermission?.(alias));
}

export function isProtectedRole(auth) {
  return Boolean(auth?.isProtectedRole);
}

export function hasAllOutletAccess(auth) {
  if (isProtectedRole(auth)) return true;
  const profile = auth?.profile ?? {};
  const outletAccessType = String(
    profile.role_outlet_access_type ??
    profile.outlet_access_type ??
    profile.outletAccess ??
    profile.role?.outlet_access_type ??
    auth?.roleOutletAccessType ??
    "",
  ).toLowerCase();
  if (["all", "all_outlets"].includes(outletAccessType)) return true;
  if (["selected", "selected_outlets"].includes(outletAccessType)) return false;
  const roleId = profile.role_id ?? profile.role?.id ?? auth?.roleId;
  const outletIds =
    profile.role_outlet_ids ??
    profile.roleOutletIds ??
    auth?.roleOutletIds ??
    auth?.accessibleOutletIds ??
    [];
  return Boolean(roleId) && outletIds.length === 0;
}

export function getAccessibleOutletIds(auth) {
  if (hasAllOutletAccess(auth)) return null;
  const outletIds =
    auth?.profile?.role_outlet_ids ??
    auth?.profile?.roleOutletIds ??
    auth?.roleOutletIds ??
    auth?.accessibleOutletIds ??
    [];
  return new Set(outletIds.map((id) => String(id)).filter(Boolean));
}

export function getAccessibleOutlets(auth, outlets = []) {
  if (hasAllOutletAccess(auth)) return outlets;
  const outletIds = getAccessibleOutletIds(auth);
  if (!outletIds?.size) return [];
  return outlets.filter((outlet) => outletIds.has(String(outlet.id)));
}

export function canAccessOutlet(auth, outletId) {
  if (!outletId) return false;
  const outletIds = getAccessibleOutletIds(auth);
  if (outletIds === null) return true;
  return outletIds.has(String(outletId));
}

export function getAccessibleOutletOptions(auth, outlets = [], { includeAll = true } = {}) {
  const accessibleOutlets = getAccessibleOutlets(auth, outlets);
  const allLabel = !auth || hasAllOutletAccess(auth) ? "All Outlets" : "All Accessible Outlets";
  return [
    ...(includeAll ? [{ value: "all", label: allLabel }] : []),
    ...accessibleOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name })),
  ];
}

export function filterOutletScopedRows(auth, rows = []) {
  if (hasAllOutletAccess(auth)) return rows;
  const outletIds = getAccessibleOutletIds(auth);
  if (!outletIds.size) return [];
  return rows.filter((row) => !row?.outlet_id || outletIds.has(String(row.outlet_id)));
}

export function canCreate(auth, moduleId) {
  return hasPermission(auth, `${moduleId}.create`);
}

export function canEdit(auth, moduleId) {
  return hasPermission(auth, `${moduleId}.edit`);
}

export function canDelete(auth, moduleId) {
  return hasPermission(auth, `${moduleId}.delete`);
}

export function canImport(auth, moduleId) {
  return hasPermission(auth, `${moduleId}.import`);
}

export function canExport(auth, moduleId) {
  return hasPermission(auth, `${moduleId}.export`);
}

export function canManage(auth, moduleId) {
  return hasPermission(auth, `${moduleId}.manage`);
}

export function canWrite(auth, moduleId) {
  return canCreate(auth, moduleId) || canEdit(auth, moduleId);
}

export function notifyPermissionDenied(ui, action = "perform this action") {
  ui?.notify?.({
    title: "Permission required",
    message: `You do not have permission to ${action}.`,
    tone: "error",
  });
}
