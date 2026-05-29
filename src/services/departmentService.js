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

  async deleteDepartment(departmentOrId) {
    const id = typeof departmentOrId === "object" ? departmentOrId.id : departmentOrId;
    let name = typeof departmentOrId === "object" ? departmentOrId.name : "";
    if (!name) {
      const { data, error } = await supabase
        .from("departments")
        .select("name")
        .eq("id", id)
        .single();
      throwSupabaseError("departments.delete_lookup", error);
      name = data?.name ?? "";
    }

    if (name) {
      const [positionsResult, employeesByDepartmentResult] = await Promise.all([
        supabase
          .from("job_positions")
          .select("id", { count: "exact", head: true })
          .eq("department", name)
          .eq("status", "active"),
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("department", name)
          .neq("employment_status", "resigned"),
      ]);
      throwSupabaseError("departments.delete_position_count", positionsResult.error);
      throwSupabaseError("departments.delete_employee_department_count", employeesByDepartmentResult.error);

      const { data: linkedPositions, error: linkedPositionError } = await supabase
        .from("job_positions")
        .select("name")
        .eq("department", name);
      throwSupabaseError("departments.delete_linked_positions", linkedPositionError);
      let employeeByPositionCount = 0;
      const positionNames = (linkedPositions ?? []).map((position) => position.name).filter(Boolean);
      if (positionNames.length) {
        const { count, error: employeePositionError } = await supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .neq("employment_status", "resigned")
          .in("position", positionNames);
        throwSupabaseError("departments.delete_employee_position_count", employeePositionError);
        employeeByPositionCount = Number(count || 0);
      }

      const linkedCount =
        Number(positionsResult.count || 0) +
        Number(employeesByDepartmentResult.count || 0) +
        employeeByPositionCount;
      if (linkedCount > 0) {
        throw new Error("This department is assigned to active positions or employees. Archive it or reassign records before deleting.");
      }
    }

    const { error } = await supabase.from("departments").delete().eq("id", id);
    throwSupabaseError("departments.delete", error);
  },
};
