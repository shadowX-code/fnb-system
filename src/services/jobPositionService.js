import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";
import { isSupabaseUuid } from "./idUtils";

function mapPosition(row, employeeCounts = new Map()) {
  return {
    id: row.id,
    name: row.name,
    department: row.department ?? "",
    description: row.description ?? "",
    status: row.status ?? "active",
    active_users: Number(row.active_users ?? employeeCounts.get(row.name) ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const jobPositionService = {
  async listJobPositions() {
    const [positionsResult, employeesResult] = await Promise.all([
      supabase.from("job_positions").select("id,name,department,description,status,created_at,updated_at").order("name", { ascending: true }),
      supabase.from("employees").select("position,employment_status"),
    ]);

    throwSupabaseError("job_positions.list", positionsResult.error);
    throwSupabaseError("job_positions.employee_counts", employeesResult.error);
    const employeeCounts = new Map();
    (employeesResult.data ?? []).forEach((employee) => {
      if (!employee.position || employee.employment_status === "resigned") return;
      employeeCounts.set(employee.position, (employeeCounts.get(employee.position) ?? 0) + 1);
    });

    return (positionsResult.data ?? []).map((row) => mapPosition(row, employeeCounts));
  },

  async saveJobPosition(position) {
    const payload = {
      name: position.name,
      department: position.department || null,
      description: position.description ?? "",
      status: position.status ?? "active",
      updated_at: new Date().toISOString(),
    };

    const isUpdate = isSupabaseUuid(position.id);
    const query = isUpdate
      ? supabase.from("job_positions").update(payload).eq("id", position.id)
      : supabase.from("job_positions").insert(payload);

    const { data, error } = await query
      .select("id,name,department,description,status,created_at,updated_at")
      .single();

    throwSupabaseError("job_positions.save", error);
    await auditLogService.createAuditLog({
      action: isUpdate ? "job_position_updated" : "job_position_created",
      module: "people",
      target: data.name,
      description: isUpdate ? "Job position updated." : "Job position created.",
      after: data,
    }).catch(() => {});
    return mapPosition(data);
  },

  async deleteJobPosition(id) {
    const { error } = await supabase.from("job_positions").delete().eq("id", id);
    throwSupabaseError("job_positions.delete", error);
  },
};
