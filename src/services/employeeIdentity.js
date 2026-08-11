export function normalizeEmployeeLoginEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function hasSameEmployeeLoginEmail(left, right) {
  return normalizeEmployeeLoginEmail(left) === normalizeEmployeeLoginEmail(right);
}
