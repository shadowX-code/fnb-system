export const PROTECTED_ROLE_NAMES = new Set(["owner", "admin"]);

export function normalizeRoleName(roleName) {
  return String(roleName ?? "").trim().toLowerCase();
}

export function isProtectedRoleName(roleName) {
  return PROTECTED_ROLE_NAMES.has(normalizeRoleName(roleName));
}

export function isProtectedRoleProfile(profile) {
  return isProtectedRoleName(profile?.role_name ?? profile?.role?.name);
}
