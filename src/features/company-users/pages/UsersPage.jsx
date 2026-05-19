import { useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, CreditCard, Edit3, Eye, KeyRound, MoreHorizontal, Plus, Power, Search, ShieldCheck, UserRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import FilterPopover from "../../../components/forms/FilterPopover.jsx";
import MultiSelectField from "../../../components/forms/MultiSelectField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { EMPLOYEE_ACCESS_STATE, EMPLOYEE_ACCESS_STATE_LABEL, normalizeEmployeeAccessState } from "../../../constants/employeeAccessStates.js";
import { employeeService } from "../../../services/employeeService.js";
import { employeeAuthOnboardingService } from "../../../services/employeeAuthOnboardingService.js";
import { jobPositionService } from "../../../services/jobPositionService.js";
import { roleService } from "../../../services/roleService.js";
import { formatDateTime } from "../../../lib/dateTime.js";
import { normalizeRoleOutletAccess } from "../utils/roleAccess.js";
import { canCreate, canEdit, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";

const fallbackRoleOptions = ["owner", "admin", "manager", "supervisor", "cashier", "kitchen", "purchaser", "finance", "hr", "staff"];
const fallbackWorkplaceOptions = ["All Outlets", "Hola Ipoh Bangsar", "Hola TTDI", "Hola Mont Kiara", "Hola Subang"];

function createEmptyUser() {
  return {
    id: "",
    full_name: "",
    nickname: "",
    nationality: "Malaysia",
    email: "",
    contact: "",
    ic_no: "",
    gender: "",
    birthday: "",
    role: "staff",
    position: "",
    workplace: "",
    outlet_access: [],
    employment_status: "full_time",
    access_state: EMPLOYEE_ACCESS_STATE.NO_ACCESS,
    enable_system_login: false,
    is_active: false,
    email_verified: false,
    last_login_at: null,
    joined_date: "",
    resigned_date: "",
    employee_code: "",
    bank_name: "",
    bank_account_number: "",
    bank_account_name: "",
    audit_summary: "New employee profile created locally.",
  };
}

function titleCase(value) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeNamePart(part) {
  if (!part) return part;
  const lower = part.toLowerCase();
  const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (/^mc[a-z]/i.test(part) && titled.length > 2) {
    return `Mc${titled.charAt(2).toUpperCase()}${titled.slice(3)}`;
  }
  return titled;
}

function normalizeOfficialName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word
      .split("-")
      .map((hyphenPart) => hyphenPart
        .split("'")
        .map(normalizeNamePart)
        .join("'"))
      .join("-"))
    .join(" ");
}

function getDisplayName(user) {
  return user.nickname || user.full_name;
}

function hasSystemLogin(employee) {
  return Boolean(employee.enable_system_login ?? employee.email ?? employee.role ?? employee.email_verified ?? employee.last_login_at);
}

function getAccessState(employee) {
  if (!hasSystemLogin(employee)) return EMPLOYEE_ACCESS_STATE.NO_ACCESS;
  const state = employee.access_state ?? employee.account_status;
  return normalizeEmployeeAccessState(state, true);
}

function getAccessStateCopy(employee) {
  const state = getAccessState(employee);
  if (state === EMPLOYEE_ACCESS_STATE.NO_ACCESS) return "System login is not enabled for this employee.";
  if (state === EMPLOYEE_ACCESS_STATE.NOT_SENT) return "Create the Supabase Auth account before this employee can sign in.";
  if (state === EMPLOYEE_ACCESS_STATE.INVITED) return "Supabase account setup is pending.";
  if (state === EMPLOYEE_ACCESS_STATE.ACTIVE) return "Employee can sign in. Role permissions and outlet scope apply.";
  return "System access is disabled. Historical records remain available.";
}

function formatDateForView(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function isValidDateInput(value) {
  if (!value) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function formatMalaysiaIc(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 12);
  if (digits.length <= 6) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 6)}-${digits.slice(6)}${digits.length === 8 ? "-" : ""}`;
  return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

function formatMalaysiaContact(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 13);
  if (!digits) return "";
  if (digits.startsWith("60")) {
    const rest = digits.slice(2);
    return rest ? `60-${rest}` : "60";
  }
  return digits;
}

function getRequiredUserFields(values) {
  const isMalaysia = values.nationality === "Malaysia";
  const required = {
    full_name: "Full Name is required.",
    nickname: "Nickname is required.",
    nationality: "Nationality is required.",
    gender: "Gender is required.",
    ic_no: isMalaysia ? "IC No. is required." : "Passport / ID No. is required.",
    contact: "Contact is required.",
    birthday: "Birthday is required.",
    employment_status: "Employment Status is required.",
    position: "Position is required.",
    workplace: "Work Place / Outlet is required.",
  };
  if (values.enable_system_login) {
    required.email = "Email is required.";
    required.role = "Role is required.";
  }
  return required;
}

function validateUserForm(values) {
  const errors = {};
  const isMalaysia = values.nationality === "Malaysia";
  const requiredFields = getRequiredUserFields(values);

  Object.entries(requiredFields).forEach(([key, message]) => {
    if (!String(values[key] ?? "").trim()) errors[key] = message;
  });

  if (values.enable_system_login && values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email).trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (isMalaysia && values.ic_no && !/^\d{6}-\d{2}-\d{4}$/.test(values.ic_no.trim())) {
    errors.ic_no = "Use format: 123456-08-1234";
  }

  if (isMalaysia && values.contact && !/^(60-\d{8,11}|60\d{8,11})$/.test(values.contact.trim())) {
    errors.contact = "Use Malaysia format, e.g. 60-123456789";
  }

  if (values.birthday && !isValidDateInput(values.birthday)) {
    errors.birthday = "Enter a valid date.";
  }

  return errors;
}

function employmentTone(status) {
  if (status === "full_time") return "success";
  if (status === "part_time") return "info";
  return "neutral";
}

function accountTone(status) {
  if (status === EMPLOYEE_ACCESS_STATE.ACTIVE) return "success";
  if (status === EMPLOYEE_ACCESS_STATE.INVITED) return "warning";
  if (status === EMPLOYEE_ACCESS_STATE.DISABLED) return "neutral";
  if (status === EMPLOYEE_ACCESS_STATE.NOT_SENT) return "info";
  return "neutral";
}

function accountLabel(status) {
  return EMPLOYEE_ACCESS_STATE_LABEL[normalizeEmployeeAccessState(status, true)] ?? titleCase(status);
}

function findJobPosition(jobPositions, positionName) {
  return jobPositions.find((position) => position.name === positionName);
}

function StatCard({ label, value, helper, tone = "neutral" }) {
  const toneClass = tone === "warning" ? "text-amber-700" : tone === "danger" ? "text-rose-700" : tone === "success" ? "text-emerald-700" : "text-text-primary";
  return (
    <Card className="p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-text-secondary">{helper}</div>
    </Card>
  );
}

function FormField({ label, required = false, error, helper, children }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </span>
      {children}
      {error ? <span className="text-[11px] font-medium text-rose-600">{error}</span> : null}
      {!error && helper ? <span className="text-[11px] text-text-muted">{helper}</span> : null}
    </label>
  );
}

function FormSection({ title, icon: Icon, children }) {
  return (
    <section className="rounded-2xl border border-border bg-slate-50/60 p-3.5">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl border border-border bg-white text-text-secondary">
          <Icon size={14} />
        </span>
        {title}
      </div>
      {children}
    </section>
  );
}

function ReadOnlyField({ label, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-text-secondary">{label}</div>
      <div className="mt-1 min-h-10 rounded-xl border border-transparent bg-white/70 px-3 py-2 text-sm font-semibold text-text-primary">
        {children || "-"}
      </div>
    </div>
  );
}

function RoleOutletAccessSummary({ roleName, roleRecords = [], outlets = [] }) {
  const role = roleRecords.find((item) => item.name === roleName);
  const access = normalizeRoleOutletAccess(role, outlets);

  if (!roleName || !role || access.mode === "none") {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="warning">No outlet access configured</Badge>
        <span className="text-xs font-medium text-text-muted">This role has no outlet access configured.</span>
      </div>
    );
  }
  if (access.mode === "all") {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="success">All Outlets</Badge>
        <span className="text-xs font-medium text-text-muted">This role can access all current and future outlets.</span>
      </div>
    );
  }
  const visible = access.outlets.slice(0, 3);
  const remaining = access.outlets.length - visible.length;
  if (!access.outlets.length) {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="warning">No outlet access configured</Badge>
        <span className="text-xs font-medium text-text-muted">This role has no outlet access configured.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((outlet) => <Badge key={outlet.id} tone="neutral">{outlet.name}</Badge>)}
      {remaining > 0 ? <Badge tone="info">+{remaining} more</Badge> : null}
    </div>
  );
}

function EmailStatusBadge({ status }) {
  const config = {
    not_checked: { tone: "neutral", label: "Not checked" },
    checking: { tone: "neutral", label: "Checking..." },
    valid: { tone: "success", label: "Available" },
    invalid: { tone: "danger", label: "Invalid" },
    used: { tone: "warning", label: "Already Exists" },
  }[status] ?? { tone: "neutral", label: "Not checked" };

  return <Badge tone={config.tone}>{config.label}</Badge>;
}

function UserFormModal({
  mode,
  initialUser,
  jobPositions,
  roleOptions = fallbackRoleOptions,
  roleRecords = [],
  workplaceOptions = fallbackWorkplaceOptions,
  outlets = [],
  users = [],
  ui,
  onClose,
  onSubmit,
  onSendLoginSetup,
  onSwitchToEdit,
  canEditEmployee = false,
  canEnableLogin = false,
  canResetPassword = false,
}) {
  const [values, setValues] = useState(() => {
    const merged = { ...createEmptyUser(), ...initialUser };
    return {
      ...merged,
      enable_system_login: Boolean(merged.enable_system_login ?? merged.email ?? merged.role ?? merged.email_verified ?? merged.last_login_at),
    };
  });
  const [errors, setErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [emailStatus, setEmailStatus] = useState("not_checked");
  const isViewMode = mode === "view";
  const isResigned = values.employment_status === "resigned";
  const isMalaysia = values.nationality === "Malaysia";
  const activeJobPositions = jobPositions.filter((position) => position.status === "active");
  const selectedPosition = findJobPosition(jobPositions, values.position);
  const hasBankInfo = Boolean(values.bank_name || values.bank_account_number || values.bank_account_name);

  useEffect(() => {
    if (isViewMode) return undefined;
    const email = String(values.email || "").trim().toLowerCase();
    if (!email) {
      setEmailStatus("not_checked");
      return undefined;
    }
    setEmailStatus("checking");
    const timer = window.setTimeout(() => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setEmailStatus("invalid");
        return;
      }
      const alreadyUsed = users.some((user) => user.id !== values.id && String(user.email || "").toLowerCase() === email);
      setEmailStatus(alreadyUsed ? "used" : "valid");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [isViewMode, users, values.email, values.id]);

  function visibleError(key) {
    return touchedFields[key] || Object.keys(errors).length ? errors[key] : undefined;
  }

  function markTouched(key) {
    setTouchedFields((current) => ({ ...current, [key]: true }));
    setErrors((current) => {
      const next = { ...current };
      const fieldError = validateUserForm(values, "full")[key];
      if (fieldError) next[key] = fieldError;
      else delete next[key];
      return next;
    });
  }

  function inputClass(error) {
    return `control ${error ? "border-rose-200 focus:border-rose-300 focus:ring-rose-50" : ""}`;
  }

  function updateValue(key, value) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setValues((current) => ({
      ...current,
      [key]:
        key === "ic_no" && current.nationality === "Malaysia"
          ? formatMalaysiaIc(value)
          : key === "contact" && current.nationality === "Malaysia"
            ? formatMalaysiaContact(value)
            : value,
      ...(key === "nationality" && value === "Malaysia" ? { ic_no: formatMalaysiaIc(current.ic_no), contact: formatMalaysiaContact(current.contact) } : {}),
      ...(key === "full_name" && !current.bank_account_name ? { bank_account_name: value } : {}),
      ...(key === "employment_status" && value !== "resigned" ? { resigned_date: "" } : {}),
      ...(key === "enable_system_login" && !value ? { email: "", role: "", access_state: EMPLOYEE_ACCESS_STATE.NO_ACCESS, is_active: false, email_verified: false } : {}),
      ...(key === "enable_system_login" && value ? { access_state: hasSystemLogin(current) ? getAccessState(current) : EMPLOYEE_ACCESS_STATE.NOT_SENT, is_active: getAccessState(current) === EMPLOYEE_ACCESS_STATE.ACTIVE } : {}),
    }));
    setTouchedFields((current) => (current[key] ? current : { ...current, [key]: true }));
  }

  function resolveSavedAccessStatus() {
    if (!values.enable_system_login) return EMPLOYEE_ACCESS_STATE.NO_ACCESS;
    return normalizeEmployeeAccessState(values.access_state ?? EMPLOYEE_ACCESS_STATE.NOT_SENT, true);
  }

  function handleSubmit({ sendLoginSetup = false } = {}) {
    if (!canEditEmployee) {
      notifyPermissionDenied(ui, "save employee profiles");
      return;
    }
    if (sendLoginSetup && !canResetPassword) {
      notifyPermissionDenied(ui, "send password setup links");
      return;
    }
    const nextErrors = validateUserForm(values);
    if (values.enable_system_login && values.email && ["invalid", "used"].includes(emailStatus)) {
      nextErrors.email = emailStatus === "used" ? "Email is already used." : "Enter a valid email address.";
    }
    setErrors(nextErrors);
    setTouchedFields((current) => ({ ...current, ...Object.fromEntries(Object.keys(nextErrors).map((key) => [key, true])) }));
    if (Object.keys(nextErrors).length) {
      ui.notify({ title: "Please complete required fields.", tone: "danger" });
      return;
    }

    setIsSaving(true);
    const normalizedFullName = normalizeOfficialName(values.full_name);
    const nextAccessStatus = resolveSavedAccessStatus();
    window.setTimeout(() => {
      onSubmit({
        ...values,
        full_name: normalizedFullName,
        nickname: values.nickname.trim(),
        bank_account_name: values.bank_account_name?.trim() || normalizedFullName,
        access_state: normalizeEmployeeAccessState(nextAccessStatus, values.enable_system_login),
        is_active: values.enable_system_login && nextAccessStatus === EMPLOYEE_ACCESS_STATE.ACTIVE,
        enable_system_login: Boolean(values.enable_system_login),
        email_verified: values.enable_system_login ? (values.email_verified ?? false) : false,
        send_login_setup: sendLoginSetup,
        audit_summary: values.enable_system_login
          ? "Employee profile saved with system login enabled. Supabase Auth account must exist before login."
          : "Employee profile saved without system login.",
      });
    }, 450);
  }

  async function sendLoginSetupForExistingEmployee() {
    if (!canResetPassword) {
      notifyPermissionDenied(ui, "send password setup links");
      return;
    }
    if (!values.email) {
      ui.notify({ title: "Email required", message: "Add an email before sending login setup.", tone: "error" });
      return;
    }
    if (!values.id) {
      ui.notify({ title: "Save employee first", message: "Save the employee profile before sending login setup email.", tone: "error" });
      return;
    }
    const confirmed = await ui.confirm({
      title: "Send login setup email?",
      message: "A secure Supabase email will let the employee set their own password. Admins cannot view or create passwords.",
      confirmLabel: "Send Login Setup",
    });
    if (!confirmed) return;
    await onSendLoginSetup?.(values);
  }

  return (
    <Modal
      title={isViewMode ? "Employee Profile" : mode === "add" ? "Add Employee" : "Edit Employee"}
      description={isViewMode ? `${values.full_name || "-"} · ${getDisplayName(values)} · ${values.position || "No position"} · ${values.workplace || "No work place"}` : values.full_name || "Enable system login only for employees who need app access. Admins cannot create, view, or recover passwords."}
      onClose={onClose}
      size="xl"
      bodyClassName="px-6"
      footer={
        isViewMode ? (
          <>
            <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
            {canEditEmployee ? <button className="btn-primary" type="button" onClick={onSwitchToEdit}>Edit Employee</button> : <Badge tone="neutral">Read-only access</Badge>}
          </>
        ) : (
          <>
            <button className="btn-secondary" type="button" disabled={isSaving} onClick={onClose}>Cancel</button>
              {values.enable_system_login && canResetPassword ? (
                <button
                  className="btn-primary"
                  type="button"
                  disabled={isSaving || emailStatus !== "valid"}
                  onClick={() => handleSubmit({ sendLoginSetup: true })}
                >
                  {isSaving ? "Saving..." : "Save & Send Login Setup"}
                </button>
              ) : null}
              <button className="btn-primary" type="button" disabled={isSaving || !canEditEmployee} onClick={() => handleSubmit()}>{isSaving ? "Saving..." : "Save Employee"}</button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <FormSection title="Personal Info" icon={UserRound}>
          {isViewMode ? (
            <div className="grid gap-3 md:grid-cols-2">
              <ReadOnlyField label="Full Name">{values.full_name}</ReadOnlyField>
              <ReadOnlyField label="Nickname">{values.nickname}</ReadOnlyField>
              <ReadOnlyField label="Gender">{values.gender}</ReadOnlyField>
              <ReadOnlyField label="Nationality">{values.nationality || "Malaysia"}</ReadOnlyField>
              <ReadOnlyField label={isMalaysia ? "IC No." : "Passport / ID No."}>{values.ic_no}</ReadOnlyField>
              <ReadOnlyField label="Birthday">{formatDateForView(values.birthday)}</ReadOnlyField>
              <ReadOnlyField label="Contact">{values.contact}</ReadOnlyField>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Full Name" required error={visibleError("full_name")}>
              <input className={inputClass(visibleError("full_name"))} value={values.full_name} onBlur={() => markTouched("full_name")} onChange={(event) => updateValue("full_name", event.target.value)} placeholder="Full name" />
            </FormField>
            <FormField label="Nickname" required error={visibleError("nickname")}>
              <input className={inputClass(visibleError("nickname"))} value={values.nickname || ""} onBlur={() => markTouched("nickname")} onChange={(event) => updateValue("nickname", event.target.value)} placeholder="Jason, Ah Boy, Aina" />
            </FormField>
            <FormField label="Gender" required error={visibleError("gender")}>
              <SelectField
                value={values.gender}
                placeholder="Select gender"
                buttonClassName={visibleError("gender") ? "border-rose-200" : ""}
                options={["Male", "Female", "Other"].map((item) => ({ value: item, label: item }))}
                onChange={(nextValue) => updateValue("gender", nextValue)}
              />
            </FormField>
            <FormField label="Nationality" required error={visibleError("nationality")}>
              <SelectField
                value={values.nationality}
                buttonClassName={visibleError("nationality") ? "border-rose-200" : ""}
                options={[
                  { value: "Malaysia", label: "Malaysia" },
                  { value: "Myanmar", label: "Myanmar" },
                ]}
                onChange={(nextValue) => updateValue("nationality", nextValue)}
              />
            </FormField>
            <FormField label={isMalaysia ? "IC No." : "Passport / ID No."} required error={visibleError("ic_no")}>
              <input
                className={inputClass(visibleError("ic_no"))}
                value={values.ic_no}
                onBlur={() => markTouched("ic_no")}
                onChange={(event) => updateValue("ic_no", event.target.value)}
                placeholder={isMalaysia ? "123456-08-1234" : "Passport or foreign ID number"}
              />
            </FormField>
            <DatePickerField label="Birthday" value={values.birthday} onChange={(value) => updateValue("birthday", value)} onBlur={() => markTouched("birthday")} error={visibleError("birthday")} required />
            <FormField label="Contact" required error={visibleError("contact")} helper={isMalaysia ? "Use Malaysia format, e.g. 60-123456789" : undefined}>
              <input
                className={inputClass(visibleError("contact"))}
                value={values.contact}
                onBlur={() => markTouched("contact")}
                onChange={(event) => updateValue("contact", event.target.value)}
                placeholder={isMalaysia ? "60-123456789" : "Foreign contact number"}
              />
            </FormField>
            </div>
          )}
        </FormSection>

        <FormSection title="Employment Info" icon={BriefcaseBusiness}>
          {isViewMode ? (
            <div className="grid gap-3 md:grid-cols-2">
              <ReadOnlyField label="Employment Status">{titleCase(values.employment_status)}</ReadOnlyField>
              <ReadOnlyField label="Position">
                <span>{values.position || "-"}</span>
                {selectedPosition?.status === "inactive" ? <span className="ml-2"><Badge tone="warning">Disabled</Badge></span> : null}
              </ReadOnlyField>
              <ReadOnlyField label="Work Place / Outlet">{values.workplace || "Missing"}</ReadOnlyField>
              <ReadOnlyField label="Employee Code">{values.employee_code || "-"}</ReadOnlyField>
              <ReadOnlyField label="Joined Date">{formatDateForView(values.joined_date)}</ReadOnlyField>
              {isResigned ? <ReadOnlyField label="Resigned Date">{formatDateForView(values.resigned_date)}</ReadOnlyField> : null}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Employment Status" required error={visibleError("employment_status")}>
              <SelectField
                value={values.employment_status}
                buttonClassName={visibleError("employment_status") ? "border-rose-200" : ""}
                helper={values.employment_status === "resigned" ? "Resigned employees should normally have inactive system access." : undefined}
                options={[
                  { value: "full_time", label: "Full Time" },
                  { value: "part_time", label: "Part Time" },
                  { value: "resigned", label: "Resigned" },
                ]}
                onChange={(nextValue) => updateValue("employment_status", nextValue)}
              />
            </FormField>
            <FormField label="Position" required error={visibleError("position")} helper="Position is the employee HR title. Role controls system permissions.">
              <SelectField
                value={values.position}
                placeholder="Select job position"
                buttonClassName={visibleError("position") ? "border-rose-200" : ""}
                searchable
                options={[
                  ...activeJobPositions.map((position) => ({ value: position.name, label: position.name })),
                  ...(values.position && selectedPosition?.status === "inactive" ? [{ value: values.position, label: `${values.position} (disabled)` }] : []),
                ]}
                onChange={(nextValue) => updateValue("position", nextValue)}
              />
            </FormField>
            <FormField label="Work Place / Outlet" required error={visibleError("workplace")}>
              <SelectField
                value={values.workplace}
                placeholder="Select work place"
                buttonClassName={visibleError("workplace") ? "border-rose-200" : ""}
                searchable
                options={workplaceOptions.map((workplace) => ({ value: workplace, label: workplace }))}
                onChange={(nextValue) => updateValue("workplace", nextValue)}
              />
            </FormField>
            <FormField label="Employee Code">
              <input className="control" value={values.employee_code || ""} onBlur={() => markTouched("employee_code")} onChange={(event) => updateValue("employee_code", event.target.value)} placeholder="EMP-001" />
            </FormField>
            <DatePickerField label="Joined Date" value={values.joined_date} onBlur={() => markTouched("joined_date")} onChange={(value) => updateValue("joined_date", value)} />
            {isResigned ? (
              <DatePickerField label="Resigned Date" value={values.resigned_date} onBlur={() => markTouched("resigned_date")} onChange={(value) => updateValue("resigned_date", value)} />
            ) : null}
            </div>
          )}
        </FormSection>

        <FormSection title="Bank Info" icon={CreditCard}>
          {isViewMode ? (
            hasBankInfo ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ReadOnlyField label="Bank Name">{values.bank_name || "-"}</ReadOnlyField>
                <ReadOnlyField label="Account Number">{values.bank_account_number || "-"}</ReadOnlyField>
                <ReadOnlyField label="Account Name">{values.bank_account_name || values.full_name || "-"}</ReadOnlyField>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-white/70 px-4 py-3 text-sm font-semibold text-text-secondary">Not provided</div>
            )
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Bank Name">
              <input className="control" value={values.bank_name || ""} onBlur={() => markTouched("bank_name")} onChange={(event) => updateValue("bank_name", event.target.value)} placeholder="Maybank" />
            </FormField>
            <FormField label="Account Number">
              <input className="control" value={values.bank_account_number || ""} onBlur={() => markTouched("bank_account_number")} onChange={(event) => updateValue("bank_account_number", event.target.value)} placeholder="Account number" />
            </FormField>
            <FormField label="Account Name">
              <input className="control" value={values.bank_account_name || ""} onBlur={() => markTouched("bank_account_name")} onChange={(event) => updateValue("bank_account_name", event.target.value)} placeholder={values.full_name || "Account holder name"} />
            </FormField>
            </div>
          )}
        </FormSection>

        <FormSection title="System Access" icon={ShieldCheck}>
          {isViewMode ? (
            values.enable_system_login ? (
              <div className="grid gap-3 md:grid-cols-2">
                <ReadOnlyField label="System Login"><Badge tone="success">Enabled</Badge></ReadOnlyField>
                <ReadOnlyField label="Email">{values.email || "-"}</ReadOnlyField>
                <ReadOnlyField label="Role"><Badge tone={values.role ? "info" : "warning"}>{values.role || "No Role"}</Badge></ReadOnlyField>
                <ReadOnlyField label="Access State">
                  <div className="flex flex-col gap-1">
                    <Badge tone={accountTone(getAccessState(values))}>{accountLabel(getAccessState(values))}</Badge>
                    <span className="text-xs font-medium text-text-muted">{getAccessStateCopy(values)}</span>
                  </div>
                </ReadOnlyField>
                <ReadOnlyField label="Password Setup">
                  {getAccessState(values) === EMPLOYEE_ACCESS_STATE.INVITED ? (
                    <Badge tone="warning">Reset Required</Badge>
                  ) : getAccessState(values) === EMPLOYEE_ACCESS_STATE.ACTIVE ? (
                    <Badge tone="success">Completed</Badge>
                  ) : getAccessState(values) === EMPLOYEE_ACCESS_STATE.NOT_SENT ? (
                    <Badge tone="info">Not Generated</Badge>
                  ) : (
                    <Badge tone="neutral">Disabled</Badge>
                  )}
                </ReadOnlyField>
                <ReadOnlyField label="Last Login">{formatDateTime(values.last_login_at)}</ReadOnlyField>
                <ReadOnlyField label="Outlet Access">
                  <RoleOutletAccessSummary roleName={values.role} roleRecords={roleRecords} outlets={outlets} />
                </ReadOnlyField>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm text-text-secondary">
                <Badge tone={accountTone(EMPLOYEE_ACCESS_STATE.NO_ACCESS)}>{accountLabel(EMPLOYEE_ACCESS_STATE.NO_ACCESS)}</Badge>
                <p className="mt-2">This employee profile has no system login account. HR data remains available for operations.</p>
              </div>
            )
          ) : (
            <>
            <div className="mb-3 rounded-xl border border-border bg-surface px-3 py-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  className="mt-1 h-4 w-4 accent-primary"
                  type="checkbox"
                  checked={Boolean(values.enable_system_login)}
                  disabled={!canEnableLogin}
                  onChange={(event) => updateValue("enable_system_login", event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-bold text-text-primary">Enable System Login</span>
                  <span className="mt-0.5 block text-xs text-text-secondary">Turn on only for employees who need to access the system.</span>
                </span>
              </label>
            </div>
            {values.enable_system_login ? (
              <>
              <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Email" required error={visibleError("email")}>
                <div>
                  <input className={`${inputClass(visibleError("email"))} w-full`} type="email" value={values.email} onBlur={() => markTouched("email")} onChange={(event) => updateValue("email", event.target.value)} placeholder="user@company.com" />
                  {values.email || emailStatus !== "not_checked" ? (
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    {emailStatus !== "not_checked" ? <EmailStatusBadge status={emailStatus} /> : null}
                    <span className={`font-medium ${
                      emailStatus === "valid"
                        ? "text-emerald-700"
                        : emailStatus === "used"
                          ? "text-amber-700"
                          : emailStatus === "invalid"
                            ? "text-rose-700"
                            : "text-text-muted"
                    }`}>
                      {emailStatus === "valid"
                        ? "Email format is valid."
                        : emailStatus === "used"
                          ? "Employee profile or auth account may already exist."
                          : emailStatus === "invalid"
                            ? "Enter a valid email address."
                            : emailStatus === "checking"
                              ? "Checking employee profile..."
                              : "Validation runs automatically."}
                    </span>
                  </div>
                  ) : null}
                </div>
              </FormField>
              <FormField label="Role" required error={visibleError("role")} helper="Role controls permissions and outlet scope. Outlet access is not assigned on the employee form.">
                <SelectField
                  value={values.role}
                  placeholder="No Role"
                  buttonClassName={visibleError("role") ? "border-rose-200" : ""}
                  searchable
                  options={roleOptions.map((role) => ({ value: role, label: role }))}
                  onChange={(nextValue) => updateValue("role", nextValue)}
                />
              </FormField>
              <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
                <div className="text-xs font-semibold text-text-secondary">Access State</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone={accountTone(getAccessState(values))}>{accountLabel(getAccessState(values))}</Badge>
                  <span className="text-xs font-medium text-text-muted">{getAccessStateCopy(values)}</span>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
                <div className="text-xs font-semibold text-text-secondary">Outlet Access</div>
                <div className="mt-1">
                  <RoleOutletAccessSummary roleName={values.role} roleRecords={roleRecords} outlets={outlets} />
                </div>
              </div>
            </div>
          {mode === "edit" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {[EMPLOYEE_ACCESS_STATE.NOT_SENT, EMPLOYEE_ACCESS_STATE.INVITED, EMPLOYEE_ACCESS_STATE.ACTIVE].includes(getAccessState(values)) ? (
                <button className="btn-secondary h-9 px-3 text-xs" type="button" disabled={!canResetPassword} onClick={sendLoginSetupForExistingEmployee}>
                  <KeyRound size={14} /> Send Login Setup Email
                </button>
              ) : null}
            </div>
          ) : null}
          </>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-slate-50 px-4 py-3 text-sm font-semibold text-text-secondary">
                Login fields are hidden until system login is enabled.
              </div>
            )}
          </>
          )}
        </FormSection>
      </div>
    </Modal>
  );
}

export default function UsersPage({ ui, store, auth }) {
  const [users, setUsers] = useState([]);
  const [jobPositions, setJobPositions] = useState([]);
  const [roleRecords, setRoleRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [workplaceFilter, setWorkplaceFilter] = useState("all");
  const [employmentFilter, setEmploymentFilter] = useState([]);
  const [accountFilter, setAccountFilter] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [profileMode, setProfileMode] = useState("view");
  const [formState, setFormState] = useState(null);
  const [actionMenuUserId, setActionMenuUserId] = useState(null);
  const canCreateEmployee = canCreate(auth, "employees");
  const canEditEmployee = canEdit(auth, "employees");
  const canDeactivateEmployee = hasPermission(auth, "employees.deactivate");
  const canEnableLogin = hasPermission(auth, "employees.enable_login");
  const canResetPassword = hasPermission(auth, "employees.reset_password");
  const roleOptions = useMemo(() => (roleRecords.length ? roleRecords.map((role) => role.name) : fallbackRoleOptions), [roleRecords]);
  const workplaceOptions = useMemo(
    () => ["All Outlets", ...(store?.outlets ?? []).map((outlet) => outlet.name)].filter(Boolean),
    [store?.outlets],
  );

  useEffect(() => {
    let ignore = false;
    async function loadEmployees() {
      setLoading(true);
      setLoadError("");
      try {
        const [employeeRows, positionRows, roleRows] = await Promise.all([
          employeeService.listEmployees(),
          jobPositionService.listJobPositions(),
          roleService.listRoleOptions(),
        ]);
        if (!ignore) {
          setUsers(employeeRows);
          setJobPositions(positionRows);
          setRoleRecords(roleRows);
        }
      } catch (error) {
        console.error("Unable to load employees", error);
        if (!ignore) setLoadError(error.message || "Unable to load employees.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadEmployees();
    return () => {
      ignore = true;
    };
  }, []);

  const roles = useMemo(() => [...new Set(users.map((user) => user.role).filter(Boolean))].sort(), [users]);
  const workplaces = useMemo(() => [...new Set(users.map((user) => user.workplace).filter(Boolean))].sort(), [users]);

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !search ||
        [user.full_name, user.email, user.ic_no, user.contact].some((value) => String(value || "").toLowerCase().includes(search));
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesWorkplace = workplaceFilter === "all" || user.workplace === workplaceFilter;
      const matchesEmployment = !employmentFilter.length || employmentFilter.includes(user.employment_status);
      const matchesAccount = !accountFilter || getAccessState(user) === accountFilter;
      return matchesSearch && matchesRole && matchesWorkplace && matchesEmployment && matchesAccount;
    });
  }, [accountFilter, employmentFilter, query, roleFilter, users, workplaceFilter]);

  const stats = {
    active: users.filter((user) => getAccessState(user) === EMPLOYEE_ACCESS_STATE.ACTIVE).length,
    disabled: users.filter((user) => getAccessState(user) === EMPLOYEE_ACCESS_STATE.DISABLED).length,
    loginEnabled: users.filter(hasSystemLogin).length,
    fullTime: users.filter((user) => user.employment_status === "full_time").length,
    partTime: users.filter((user) => user.employment_status === "part_time").length,
    resigned: users.filter((user) => user.employment_status === "resigned").length,
  };

  function updateUserAccount(userId, updates) {
    const current = users.find((user) => user.id === userId);
    if (!current) return;
    employeeService.saveEmployee({ ...current, ...updates }).then((saved) => {
      setUsers((list) => list.map((user) => (user.id === userId ? saved : user)));
      setSelectedUser((selected) => (selected?.id === userId ? saved : selected));
    }).catch((error) => {
      console.error("Unable to update employee", error);
      ui.notify({ title: "Unable to update employee", message: error.message || "Please try again.", tone: "error" });
    });
  }

  function closeActionMenu() {
    setActionMenuUserId(null);
  }

  const [setupLink, setSetupLink] = useState(null);

  async function sendLoginSetupForUser(user, { mode = "email" } = {}) {
    if (!canResetPassword) {
      notifyPermissionDenied(ui, "send password setup links");
      return;
    }
    if (!user.email) {
      ui.notify({ title: "Email required", message: "Add an email before sending login setup.", tone: "error" });
      return;
    }
    try {
      const result = await employeeAuthOnboardingService.sendLoginSetupEmail(user.id, { mode });
      const updatedUser = {
        ...user,
        auth_user_id: result.auth_user_id,
        access_state: EMPLOYEE_ACCESS_STATE.INVITED,
        enable_system_login: true,
        is_active: true,
        email_verified: false,
        verification_sent_at: new Date().toISOString(),
        audit_summary: result.warning || "Supabase login setup email sent.",
      };
      setUsers((list) => list.map((item) => (item.id === user.id ? updatedUser : item)));
      setSelectedUser((selected) => (selected?.id === user.id ? updatedUser : selected));
      try {
        const refreshedUsers = await employeeService.listEmployees();
        setUsers(refreshedUsers);
        setSelectedUser((selected) => refreshedUsers.find((item) => item.id === selected?.id) ?? selected);
      } catch (refreshError) {
        console.warn("Login setup succeeded, but employee refresh failed", refreshError);
      }
      if (result.setupUrl) setSetupLink({ email: result.email, link: result.setupUrl });
      ui.notify({
        title: result.setupUrl ? "Setup link generated." : "Login setup email sent.",
        message: result.warning || result.message || result.email || user.email,
        tone: result.warning ? "warning" : undefined,
      });
      closeActionMenu();
      return result;
    } catch (error) {
      console.error("Unable to send login setup", error);
      if (error.code === "SMTP_NOT_CONFIGURED" && error.canGenerateManualLink && auth?.hasPermission?.("roles.edit") && mode !== "manual_link") {
        const ok = await ui.confirm({
          title: "Email sending is not configured",
          message: "Supabase Auth SMTP is not configured. Generate a secure setup link to copy manually?",
          confirmLabel: "Generate Setup Link",
        });
        if (ok) return sendLoginSetupForUser(user, { mode: "manual_link" });
      }
      ui.notify({ title: "Unable to send login setup", message: error.message || "Please configure Supabase Auth SMTP.", tone: "error" });
      throw error;
    }
  }

  async function disableUserAccess(user) {
    if (!canDeactivateEmployee) {
      notifyPermissionDenied(ui, "disable employee access");
      return;
    }
    // TODO: support scheduled deactivation windows once account policy rules are added.
    const confirmed = await ui.confirm({
      title: "Disable system access?",
      message: "This user will no longer be able to access the system. Historical records will remain.",
      confirmLabel: "Disable Access",
      danger: true,
    });
    if (!confirmed) return;
    updateUserAccount(user.id, {
      access_state: EMPLOYEE_ACCESS_STATE.DISABLED,
      is_active: false,
      audit_summary: "System access disabled locally. Historical records remain available.",
    });
    ui.notify({ title: "System access disabled.", message: "Historical records remain available." });
    closeActionMenu();
  }

  function activateUser(user) {
    if (!canEnableLogin) {
      notifyPermissionDenied(ui, "activate employee login");
      return;
    }
    updateUserAccount(user.id, {
      enable_system_login: true,
      access_state: EMPLOYEE_ACCESS_STATE.ACTIVE,
      is_active: true,
      email_verified: true,
      audit_summary: "System access reactivated locally.",
    });
    ui.notify({ title: "Employee login activated.", message: user.email });
    closeActionMenu();
  }

  function openUserProfile(user, mode = "view") {
    setSelectedUser(user);
    setProfileMode(mode);
  }

  async function saveUser(user) {
    const isNew = !user.id;
    if ((isNew && !canCreateEmployee) || (!isNew && !canEditEmployee)) {
      notifyPermissionDenied(ui, isNew ? "create employees" : "edit employees");
      return;
    }
    try {
      const shouldSendLoginSetup = Boolean(user.send_login_setup);
      const payload = { ...user };
      delete payload.send_login_setup;
      let saved = await employeeService.saveEmployee(payload);
      if (shouldSendLoginSetup) {
        const setupResult = await sendLoginSetupForUser(saved);
        if (setupResult?.auth_user_id) {
          saved = {
            ...saved,
            auth_user_id: setupResult.auth_user_id,
            access_state: EMPLOYEE_ACCESS_STATE.INVITED,
            enable_system_login: true,
            email_verified: false,
            is_active: true,
          };
        }
      }
      setUsers((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current];
      });
      setSelectedUser(null);
      setFormState(null);
      ui.notify({ title: "Employee saved successfully.", message: saved.email || saved.full_name });
    } catch (error) {
      console.error("Unable to save employee", error);
      ui.notify({ title: "Unable to save employee", message: error.message || "Please try again.", tone: "error" });
    }
  }

  function renderAccountActions(row) {
    const buttonClass = "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50";
    const dangerClass = "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50";
    const accessState = getAccessState(row);

    if (accessState === EMPLOYEE_ACCESS_STATE.NO_ACCESS) {
      return canEnableLogin ? (
        <button className={buttonClass} type="button" onClick={() => { openUserProfile({ ...row, enable_system_login: true }, "edit"); setActionMenuUserId(null); }}>
          <ShieldCheck size={14} /> Enable Login
        </button>
      ) : null;
    }

    if (accessState === EMPLOYEE_ACCESS_STATE.ACTIVE) {
      return (
        <>
          {canResetPassword ? <button className={buttonClass} type="button" onClick={() => sendLoginSetupForUser(row)}>
            <KeyRound size={14} /> Send Login Setup
          </button> : null}
          {canDeactivateEmployee ? <button className={dangerClass} type="button" onClick={() => disableUserAccess(row)}>
            <Power size={14} /> Disable Access
          </button> : null}
        </>
      );
    }

    if (accessState === EMPLOYEE_ACCESS_STATE.NOT_SENT || accessState === EMPLOYEE_ACCESS_STATE.INVITED) {
      return (
        <>
          {canResetPassword ? <button className={buttonClass} type="button" onClick={() => sendLoginSetupForUser(row)}>
            <KeyRound size={14} /> Send Login Setup
          </button> : null}
          {canDeactivateEmployee ? <button className={dangerClass} type="button" onClick={() => disableUserAccess(row)}>
            <Power size={14} /> Disable Access
          </button> : null}
        </>
      );
    }

    if (accessState === EMPLOYEE_ACCESS_STATE.DISABLED) {
      return (
        <>
          {canEnableLogin ? <button className={buttonClass} type="button" onClick={() => activateUser(row)}>
            <Power size={14} /> Activate Access
          </button> : null}
        </>
      );
    }

    return (
      canEnableLogin ? <button className={buttonClass} type="button" onClick={() => activateUser(row)}>
        <Power size={14} /> Activate Access
      </button> : null
    );
  }

  const columns = [
    {
      key: "employee",
      header: "Employee",
      sticky: true,
      width: "260px",
      render: (row) => (
        <button className="max-w-[240px] text-left" type="button" onClick={(event) => { event.stopPropagation(); openUserProfile(row); }}>
          <div className="truncate text-sm font-bold text-text-primary">{getDisplayName(row)}</div>
          <div className="truncate text-xs font-medium text-text-secondary">{hasSystemLogin(row) ? row.email : "No system login"}</div>
          <div className="hidden truncate text-xs text-text-muted md:block">{row.contact}</div>
        </button>
      ),
    },
    { key: "role", header: "Role", render: (row) => (hasSystemLogin(row) ? (row.role ? <Badge tone={row.role === "owner" ? "info" : "neutral"}>{row.role}</Badge> : <Badge tone="warning">No Role</Badge>) : <Badge tone="neutral">Login Off</Badge>) },
    {
      key: "position",
      header: "Position",
      render: (row) => {
        const position = findJobPosition(jobPositions, row.position);
        return (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-text-primary">{row.position || "-"}</span>
            {position?.status === "inactive" ? <Badge tone="warning">Disabled position</Badge> : null}
          </div>
        );
      },
    },
    { key: "workplace", header: "Work Place", render: (row) => row.workplace || <Badge tone="warning">Missing</Badge> },
    { key: "employment_status", header: "Employment Status", render: (row) => <Badge tone={employmentTone(row.employment_status)}>{titleCase(row.employment_status)}</Badge> },
    { key: "account", header: "Access State", render: (row) => {
      const accessState = getAccessState(row);
      return <Badge tone={accountTone(accessState)}>{accountLabel(accessState)}</Badge>;
    } },
    { key: "last_login", header: "Last Login", className: "hidden lg:table-cell", headerClassName: "hidden lg:table-cell", render: (row) => <span className="text-xs font-medium text-text-secondary">{formatDateTime(row.last_login_at)}</span> },
    {
      key: "action",
      header: "Actions",
      align: "right",
      width: "76px",
      render: (row) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <ActionMenu
            open={actionMenuUserId === row.id}
            onOpenChange={(nextOpen) => setActionMenuUserId(nextOpen ? row.id : null)}
            width={192}
            ariaLabel="User actions"
            trigger={({ toggle, ariaLabel }) => (
              <button className="icon-btn" type="button" aria-label={ariaLabel} onClick={toggle}>
                <MoreHorizontal size={15} />
              </button>
            )}
          >
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { openUserProfile(row); setActionMenuUserId(null); }}>
                <Eye size={14} /> View
              </button>
              {canEditEmployee ? <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { openUserProfile(row, "edit"); setActionMenuUserId(null); }}>
                <Edit3 size={14} /> Edit
              </button> : null}
              {renderAccountActions(row)}
          </ActionMenu>
        </div>
      ),
    },
  ];
  const pageCopy = {
    section: "People",
    title: "Employees",
    description: "Manage employee HR profiles, employment data, bank information, and optional system login access.",
    action: "Add Employee",
    cardTitle: "Employee Directory",
    cardDescription: "One employee profile contains HR data and optional system access. Not every employee needs a login.",
  };

  return (
    <div className="space-y-4">
      <PageHeader
        section={pageCopy.section}
        title={pageCopy.title}
        description={pageCopy.description}
        actions={
          canCreateEmployee ? <button className="btn-primary" type="button" onClick={() => setFormState({ mode: "add", user: createEmptyUser() })}>
            <Plus size={16} /> {pageCopy.action}
          </button> : <Badge tone="neutral">Read-only access</Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Login Enabled" value={stats.loginEnabled} helper="Employees with system access configured" tone="success" />
        <StatCard label="Access Active" value={stats.active} helper="Can access the system" tone="success" />
        <StatCard label="Access Disabled" value={stats.disabled} helper="System access disabled" tone={stats.disabled ? "warning" : "neutral"} />
        <StatCard label="Full Time" value={stats.fullTime} helper="Full-time employees" />
        <StatCard label="Part Time" value={stats.partTime} helper="Part-time employees" />
      </div>

      <FilterBar compact>
        <FieldLabel label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input className="control h-9 min-w-[280px] pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, IC, contact..." />
          </div>
        </FieldLabel>
        <FieldLabel label="Role">
          <FilterPopover
            value={roleFilter === "all" ? "" : roleFilter}
            placeholder="All Roles"
            options={roles.map((role) => ({ value: role, label: role }))}
            onApply={(nextValue) => setRoleFilter(nextValue || "all")}
          />
        </FieldLabel>
        <FieldLabel label="Work Place">
          <FilterPopover
            value={workplaceFilter === "all" ? "" : workplaceFilter}
            placeholder="All Work Places"
            className="min-w-44"
            options={workplaces.map((workplace) => ({ value: workplace, label: workplace }))}
            onApply={(nextValue) => setWorkplaceFilter(nextValue || "all")}
          />
        </FieldLabel>
        <FieldLabel label="Employment">
          <MultiSelectField
            value={employmentFilter}
            placeholder="All Status"
            options={[
              { value: "full_time", label: "Full Time" },
              { value: "part_time", label: "Part Time" },
              { value: "resigned", label: "Resigned" },
            ]}
            onApply={setEmploymentFilter}
          />
        </FieldLabel>
        <FieldLabel label="Access State">
          <FilterPopover
            value={accountFilter}
            placeholder="All Access"
            options={[
              { value: EMPLOYEE_ACCESS_STATE.NO_ACCESS, label: EMPLOYEE_ACCESS_STATE_LABEL[EMPLOYEE_ACCESS_STATE.NO_ACCESS] },
              { value: EMPLOYEE_ACCESS_STATE.NOT_SENT, label: EMPLOYEE_ACCESS_STATE_LABEL[EMPLOYEE_ACCESS_STATE.NOT_SENT] },
              { value: EMPLOYEE_ACCESS_STATE.INVITED, label: EMPLOYEE_ACCESS_STATE_LABEL[EMPLOYEE_ACCESS_STATE.INVITED] },
              { value: EMPLOYEE_ACCESS_STATE.ACTIVE, label: EMPLOYEE_ACCESS_STATE_LABEL[EMPLOYEE_ACCESS_STATE.ACTIVE] },
              { value: EMPLOYEE_ACCESS_STATE.DISABLED, label: EMPLOYEE_ACCESS_STATE_LABEL[EMPLOYEE_ACCESS_STATE.DISABLED] },
            ]}
            onApply={setAccountFilter}
          />
        </FieldLabel>
      </FilterBar>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 shrink-0 text-blue-700" size={16} />
          <p>
            <strong>Security note:</strong> FeedX now uses real Supabase Auth sessions only. Admins can send password setup links, but cannot create, view, or recover passwords.
          </p>
        </div>
      </div>

      <Card title={pageCopy.cardTitle} description={pageCopy.cardDescription}>
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading employees...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{loadError}</div>
        ) : filteredUsers.length ? (
          <DataTable columns={columns} rows={filteredUsers} getRowKey={(row) => row.id} onRowClick={(row) => openUserProfile(row)} tableClassName="min-w-[980px]" />
        ) : (
          <div className="p-8 text-center">
            <div className="text-sm font-bold text-text-primary">No employees found. Add your first team member.</div>
            <p className="mt-1 text-sm text-text-secondary">Adjust filters or create a new employee profile.</p>
          </div>
        )}
      </Card>

      {selectedUser ? (
        <UserFormModal
          mode={profileMode}
          initialUser={selectedUser}
          jobPositions={jobPositions}
          roleOptions={roleOptions}
          roleRecords={roleRecords}
          workplaceOptions={workplaceOptions}
          outlets={store?.outlets ?? []}
          users={users}
          ui={ui}
          canEditEmployee={canEditEmployee}
          canEnableLogin={canEnableLogin}
          canResetPassword={canResetPassword}
          onClose={() => setSelectedUser(null)}
          onSendLoginSetup={sendLoginSetupForUser}
          onSwitchToEdit={() => setProfileMode("edit")}
          onSubmit={(user) => {
            saveUser(user);
            setSelectedUser(null);
          }}
        />
      ) : null}
      {formState ? (
        <UserFormModal
          mode={formState.mode}
          initialUser={formState.user}
          jobPositions={jobPositions}
          roleOptions={roleOptions}
          roleRecords={roleRecords}
          workplaceOptions={workplaceOptions}
          outlets={store?.outlets ?? []}
          users={users}
          ui={ui}
          canEditEmployee={formState.mode === "add" ? canCreateEmployee : canEditEmployee}
          canEnableLogin={canEnableLogin}
          canResetPassword={canResetPassword}
          onClose={() => setFormState(null)}
          onSendLoginSetup={sendLoginSetupForUser}
          onSubmit={saveUser}
        />
      ) : null}
      {setupLink ? (
        <Modal
          title="Login Setup Link Generated"
          description="Email sending is not configured, so this secure Supabase setup link was generated manually."
          onClose={() => setSetupLink(null)}
          footer={<button className="btn-primary" type="button" onClick={() => setSetupLink(null)}>Done</button>}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-text-muted">Email</div>
              <div className="mt-1 font-semibold text-text-primary">{setupLink.email}</div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-bold uppercase text-amber-700">Setup Link</div>
              <div className="mt-2 break-all rounded-xl bg-white p-3 text-xs font-semibold text-text-primary">{setupLink.link}</div>
              <button
                className="btn-secondary mt-3 h-9 text-xs"
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(setupLink.link);
                  ui.notify({ title: "Setup link copied." });
                }}
              >
                Copy Link
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
