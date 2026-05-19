export function hasPermission(auth, code) {
  return Boolean(auth?.hasPermission?.(code));
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
