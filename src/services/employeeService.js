import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";
import { isSupabaseUuid } from "./idUtils";

function mapEmployee(row) {
  return {
    id: row.id,
    full_name: row.full_name ?? "",
    nickname: row.nickname ?? "",
    nationality: row.nationality ?? "Malaysia",
    email: row.email ?? "",
    contact: row.contact ?? "",
    ic_no: row.ic_no ?? "",
    gender: row.gender ?? "",
    birthday: row.birthday ?? "",
    role: row.role?.name ?? row.role_name ?? "",
    role_id: row.role_id ?? "",
    position: row.position ?? "",
    workplace: row.workplace ?? "",
    department: row.department ?? "",
    outlet_access: [],
    employment_status: row.employment_status ?? "full_time",
    access_state: row.access_state ?? "no_access",
    enable_system_login: Boolean(row.enable_system_login),
    is_active: Boolean(row.is_active),
    email_verified: Boolean(row.email_verified),
    last_login_at: row.last_login_at,
    joined_date: row.joined_date ?? "",
    resigned_date: row.resigned_date ?? "",
    employee_code: row.employee_code ?? "",
    bank_name: row.bank_name ?? "",
    bank_account_number: row.bank_account_number ?? "",
    bank_account_name: row.bank_account_name ?? "",
    audit_summary: row.audit_summary ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const employeeService = {
  async listEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("*,role:roles(id,name,description)")
      .order("full_name", { ascending: true });

    throwSupabaseError("employees.list", error);
    return (data ?? []).map(mapEmployee);
  },

  async saveEmployee(employee) {
    let roleId = employee.role_id || null;
    if (!roleId && employee.role) {
      const { data: role } = await supabase.from("roles").select("id").eq("name", employee.role).maybeSingle();
      roleId = role?.id ?? null;
    }

    const payload = {
      full_name: employee.full_name,
      nickname: employee.nickname ?? "",
      nationality: employee.nationality ?? "Malaysia",
      email: employee.enable_system_login ? employee.email : null,
      contact: employee.contact ?? "",
      ic_no: employee.ic_no ?? "",
      gender: employee.gender ?? "",
      birthday: employee.birthday || null,
      employment_status: employee.employment_status ?? "full_time",
      department: employee.department || null,
      position: employee.position || null,
      workplace: employee.workplace || null,
      employee_code: employee.employee_code || null,
      joined_date: employee.joined_date || null,
      resigned_date: employee.resigned_date || null,
      bank_name: employee.bank_name || null,
      bank_account_number: employee.bank_account_number || null,
      bank_account_name: employee.bank_account_name || employee.full_name,
      enable_system_login: Boolean(employee.enable_system_login),
      role_id: employee.enable_system_login ? roleId : null,
      access_state: employee.access_state ?? (employee.enable_system_login ? "not_sent" : "no_access"),
      is_active: Boolean(employee.is_active),
      email_verified: Boolean(employee.email_verified),
      verification_sent_at: employee.access_state === "invited" || employee.access_state === "temp_password_active" ? new Date().toISOString() : employee.verification_sent_at ?? null,
      access_disabled_at: employee.access_state === "disabled" ? new Date().toISOString() : employee.access_disabled_at ?? null,
      last_login_at: employee.last_login_at ?? null,
      audit_summary: employee.audit_summary ?? "",
      updated_at: new Date().toISOString(),
    };

    const isUpdate = isSupabaseUuid(employee.id);
    const query = isUpdate
      ? supabase.from("employees").update(payload).eq("id", employee.id)
      : supabase.from("employees").insert(payload);

    const { data, error } = await query
      .select("*,role:roles(id,name,description)")
      .single();

    throwSupabaseError("employees.save", error);
    await auditLogService.createAuditLog({
      action: isUpdate ? "employee_updated" : "employee_created",
      module: "people",
      target: data.full_name,
      description: isUpdate ? "Employee profile updated." : "Employee profile created.",
      after: data,
    }).catch(() => {});
    return mapEmployee(data);
  },
};
