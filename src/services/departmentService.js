import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";
import { isSupabaseUuid } from "./idUtils";

function mapDepartment(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    status: row.status ?? (row.is_active === false ? "inactive" : "active"),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const departmentService = {
  async listDepartments() {
    const { data, error } = await supabase
      .from("departments")
      .select("id,name,description,status,created_at,updated_at")
      .order("name", { ascending: true });

    throwSupabaseError("departments.list", error);
    return (data ?? []).map(mapDepartment);
  },

  async saveDepartment(department) {
    const payload = {
      name: department.name,
      description: department.description ?? "",
      status: department.status ?? "active",
      updated_at: new Date().toISOString(),
    };

    const isUpdate = isSupabaseUuid(department.id);
    const query = isUpdate
      ? supabase.from("departments").update(payload).eq("id", department.id)
      : supabase.from("departments").insert(payload);

    const { data, error } = await query
      .select("id,name,description,status,created_at,updated_at")
      .single();

    throwSupabaseError("departments.save", error);
    await auditLogService.createAuditLog({
      action: isUpdate ? "department_updated" : "department_created",
      module: "people",
      target: data.name,
      description: isUpdate ? "Department updated." : "Department created.",
      after: data,
    }).catch(() => {});
    return mapDepartment(data);
  },

  async deleteDepartment(id) {
    const { error } = await supabase.from("departments").delete().eq("id", id);
    throwSupabaseError("departments.delete", error);
  },
};
