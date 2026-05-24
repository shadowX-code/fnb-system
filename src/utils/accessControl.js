export function hasPermission(auth, code) {
  return Boolean(auth?.hasPermission?.(code));
}

export function isProtectedRole(auth) {
  return Boolean(auth?.isProtectedRole);
}

export function getAccessibleOutletIds(auth) {
  if (isProtectedRole(auth)) return null;
  const outletIds =
    auth?.profile?.role_outlet_ids ??
    auth?.profile?.roleOutletIds ??
    auth?.roleOutletIds ??
    auth?.accessibleOutletIds ??
    [];
  return new Set(outletIds.map((id) => String(id)).filter(Boolean));
}

export function getAccessibleOutlets(auth, outlets = []) {
  if (isProtectedRole(auth)) return outlets;
  const outletIds = getAccessibleOutletIds(auth);
  if (!outletIds?.size) return [];
  return outlets.filter((outlet) => outletIds.has(String(outlet.id)));
}

export function canAccessOutlet(auth, outletId) {
  if (!outletId) return false;
  if (isProtectedRole(auth)) return true;
  return getAccessibleOutletIds(auth).has(String(outletId));
}

export function filterOutletScopedRows(auth, rows = []) {
  if (isProtectedRole(auth)) return rows;
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
