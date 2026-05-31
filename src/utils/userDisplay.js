const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value) {
  return UUID_PATTERN.test(String(value || ""));
}

export function getEmployeeDisplayName(employeeOrId, options = {}) {
  const normalizedOptions = typeof options === "string" ? { fallback: options } : options;
  const fallback = normalizedOptions.fallback || "Unknown User";
  if (!employeeOrId) return fallback;

  if (typeof employeeOrId === "object") {
    return employeeOrId.nickname ||
      employeeOrId.full_name ||
      employeeOrId.fullName ||
      employeeOrId.name ||
      employeeOrId.email ||
      fallback;
  }

  const actorId = String(employeeOrId || "").trim();
  const currentProfile = normalizedOptions.currentProfile || normalizedOptions.profile || {};
  const currentUser = normalizedOptions.currentUser || normalizedOptions.user || {};
  const currentIds = [currentProfile.id, currentProfile.auth_user_id, currentUser.id].filter(Boolean);

  const employeeActorMap = normalizedOptions.employeeActorMap;
  if (actorId && employeeActorMap) {
    const mappedName = employeeActorMap instanceof Map ? employeeActorMap.get(actorId) : employeeActorMap[actorId];
    if (mappedName) return mappedName;
  }

  if (actorId && currentIds.includes(actorId)) {
    return getEmployeeDisplayName(currentProfile, currentUser.email || fallback);
  }

  const employees = normalizedOptions.employees || [];
  const employee = employees.find((person) => (
    person?.id === actorId ||
    person?.auth_user_id === actorId ||
    person?.authUserId === actorId ||
    person?.email === actorId
  ));
  if (employee) return getEmployeeDisplayName(employee, fallback);

  if (isUuidLike(actorId)) return fallback;
  return actorId || fallback;
}
