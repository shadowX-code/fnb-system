export const EMPLOYEE_ACCESS_STATE = {
  NO_ACCESS: "no_access",
  NOT_SENT: "not_sent",
  INVITED: "invited",
  ACTIVE: "active",
  DISABLED: "disabled",
};

export const EMPLOYEE_ACCESS_STATE_LABEL = {
  [EMPLOYEE_ACCESS_STATE.NO_ACCESS]: "No Access",
  [EMPLOYEE_ACCESS_STATE.NOT_SENT]: "Not Sent",
  [EMPLOYEE_ACCESS_STATE.INVITED]: "Invitation Pending",
  [EMPLOYEE_ACCESS_STATE.ACTIVE]: "Active",
  [EMPLOYEE_ACCESS_STATE.DISABLED]: "Disabled",
};

const VALID_ACCESS_STATES = new Set(Object.values(EMPLOYEE_ACCESS_STATE));

export function normalizeEmployeeAccessState(value, enableSystemLogin = true) {
  if (!enableSystemLogin) return EMPLOYEE_ACCESS_STATE.NO_ACCESS;

  const rawValue = String(value ?? "").trim();
  const normalized = rawValue.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const aliases = {
    no_access: EMPLOYEE_ACCESS_STATE.NO_ACCESS,
    login_off: EMPLOYEE_ACCESS_STATE.NO_ACCESS,
    disabled_login: EMPLOYEE_ACCESS_STATE.NO_ACCESS,
    not_sent: EMPLOYEE_ACCESS_STATE.NOT_SENT,
    draft: EMPLOYEE_ACCESS_STATE.NOT_SENT,
    pending: EMPLOYEE_ACCESS_STATE.NOT_SENT,
    invitation_pending: EMPLOYEE_ACCESS_STATE.INVITED,
    pending_invite: EMPLOYEE_ACCESS_STATE.INVITED,
    invited: EMPLOYEE_ACCESS_STATE.INVITED,
    active: EMPLOYEE_ACCESS_STATE.ACTIVE,
    inactive: EMPLOYEE_ACCESS_STATE.DISABLED,
    disabled: EMPLOYEE_ACCESS_STATE.DISABLED,
    access_disabled: EMPLOYEE_ACCESS_STATE.DISABLED,
  };
  const mapped = aliases[normalized] ?? normalized;

  if (VALID_ACCESS_STATES.has(mapped)) return mapped;

  if (import.meta.env.DEV && rawValue) {
    console.warn(`[employeeAccessStates] Unknown access_state "${rawValue}" normalized to no_access.`);
  }
  return EMPLOYEE_ACCESS_STATE.NO_ACCESS;
}
