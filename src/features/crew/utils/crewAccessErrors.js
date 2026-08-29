const safeMessages = [
  [/Missing permission to manage Crew Access/i, "You do not have permission to manage Crew Access."],
  [/outside your current outlet scope|outlet scope is unavailable or inaccessible/i, "This employee is outside your current outlet scope."],
  [/Crew Access can be activated only for an active employee/i, "Crew Access can be activated only for an active employee."],
  [/Activate Crew Access before resetting its passcode/i, "Activate Crew Access before resetting its passcode."],
  [/Crew Access must be active before Special Access can be configured/i, "Activate Crew Access before configuring Special Access."],
  [/Passcode must be four digits/i, "Passcode must be four digits and meet Crew security requirements."],
];

export function crewAccessMutationError(error, fallback) {
  const message = String(error?.message || "");
  const matched = safeMessages.find(([pattern]) => pattern.test(message));
  return matched ? matched[1] : fallback;
}
