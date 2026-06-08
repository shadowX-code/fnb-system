import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const selectFields = `
  id,outlet_id,employee_id,roster_date,shift_template_id,start_time,end_time,break_minutes,status,remark,created_by,updated_by,created_at,updated_at,
  employee_name_snapshot,position_snapshot,department_snapshot,outlet_snapshot,shift_snapshot,publish_timestamp,
  shift_template:shift_templates(id,outlet_id,name,code,start_time,end_time,break_minutes,shift_type,color),
  employee:employees(id,full_name,nickname,position,department,workplace,employee_code,employment_status,is_active)
`;

function mapRoster(row) {
  const shiftSnapshot = row.shift_snapshot && typeof row.shift_snapshot === "object" ? row.shift_snapshot : null;
  const template = row.shift_template?.outlet_id === row.outlet_id
    ? row.shift_template
    : shiftSnapshot
      ? {
          id: row.shift_template_id,
          name: shiftSnapshot.name,
          code: shiftSnapshot.code,
          start_time: shiftSnapshot.start_time,
          end_time: shiftSnapshot.end_time,
          break_minutes: shiftSnapshot.break_minutes,
          shift_type: shiftSnapshot.shift_type,
          color: shiftSnapshot.color,
        }
      : null;
  const employee = row.employee ?? null;
  const employeeName = row.employee_name_snapshot || employee?.nickname || employee?.full_name || "";
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    employee_id: row.employee_id,
    roster_date: row.roster_date,
    shift_template_id: row.shift_template_id,
    start_time: row.start_time ?? template?.start_time ?? "",
    end_time: row.end_time ?? template?.end_time ?? "",
    break_minutes: Number(row.break_minutes ?? template?.break_minutes ?? 0),
    status: row.status ?? "draft",
    remark: row.remark ?? "",
    template: template ? {
      id: template.id,
      name: template.name,
      code: template.code,
      shift_type: template.shift_type,
      color: template.color,
    } : null,
    employee_snapshot: employeeName ? {
      id: row.employee_id,
      full_name: employeeName,
      nickname: employeeName,
      position: row.position_snapshot || employee?.position || "",
      department: row.department_snapshot || employee?.department || "",
      workplace: row.outlet_snapshot || employee?.workplace || "",
      employee_code: employee?.employee_code || "",
      employment_status: employee?.employment_status || "",
      is_active: employee?.is_active,
      is_roster_snapshot: Boolean(row.employee_name_snapshot || row.position_snapshot || row.department_snapshot || row.outlet_snapshot || row.publish_timestamp),
    } : null,
    employee_name_snapshot: row.employee_name_snapshot ?? "",
    position_snapshot: row.position_snapshot ?? "",
    department_snapshot: row.department_snapshot ?? "",
    outlet_snapshot: row.outlet_snapshot ?? "",
    shift_snapshot: shiftSnapshot,
    publish_timestamp: row.publish_timestamp,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildShiftSnapshot(snapshot) {
  const template = snapshot?.template;
  if (!template) return null;
  return {
    id: template.id ?? snapshot.shift_template_id ?? null,
    name: template.name ?? "",
    code: template.code ?? "",
    start_time: snapshot.start_time ?? template.start_time ?? null,
    end_time: snapshot.end_time ?? template.end_time ?? null,
    break_minutes: Number(snapshot.break_minutes ?? template.break_minutes ?? 0),
    shift_type: template.shift_type ?? "",
    color: template.color ?? "",
  };
}

function buildPublishedPayload(status, snapshot) {
  const now = new Date().toISOString();
  const payload = { status, updated_at: now };
  if (status !== "published") return payload;
  return {
    ...payload,
    employee_name_snapshot: snapshot?.employee_name_snapshot || snapshot?.employeeNameSnapshot || "",
    position_snapshot: snapshot?.position_snapshot || snapshot?.positionSnapshot || "",
    department_snapshot: snapshot?.department_snapshot || snapshot?.departmentSnapshot || "",
    outlet_snapshot: snapshot?.outlet_snapshot || snapshot?.outletSnapshot || "",
    shift_snapshot: buildShiftSnapshot(snapshot),
    publish_timestamp: now,
  };
}

export const dutyRosterService = {
  async listDutyRosters(outletId, startDate, endDate) {
    const { data, error } = await supabase
      .from("duty_rosters")
      .select(selectFields)
      .eq("outlet_id", outletId)
      .gte("roster_date", startDate)
      .lte("roster_date", endDate)
      .order("roster_date", { ascending: true });

    throwSupabaseError("duty_rosters.list", error);
    return (data ?? []).map(mapRoster);
  },

  async saveDutyRoster({ outletId, employeeId, rosterDate, template, status = "draft", remark = "" }) {
    if (template?.outlet_id !== outletId) {
      throw new Error("This shift template is not available for the selected outlet.");
    }

    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      outlet_id: outletId,
      employee_id: employeeId,
      roster_date: rosterDate,
      shift_template_id: template?.id ?? null,
      start_time: template?.start_time || null,
      end_time: template?.end_time || null,
      break_minutes: Number(template?.break_minutes || 0),
      status,
      remark,
      updated_by: userData?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("duty_rosters")
      .upsert(payload, { onConflict: "outlet_id,employee_id,roster_date" })
      .select(selectFields)
      .single();

    throwSupabaseError("duty_rosters.save", error);

    await auditLogService.createAuditLog({
      action: data.created_at === data.updated_at ? "duty_roster_shift_created" : "duty_roster_shift_updated",
      module: "duty_roster",
      target: `${rosterDate} shift`,
      description: "Duty roster shift saved.",
      outlet: outletId,
      after: {
        employee_id: employeeId,
        shift: template?.name ?? "Unassigned",
        roster_date: rosterDate,
      },
    }).catch(() => {});

    return mapRoster(data);
  },

  async deleteDutyRoster(id, context = {}) {
    const { error } = await supabase
      .from("duty_rosters")
      .delete()
      .eq("id", id);

    throwSupabaseError("duty_rosters.delete", error);

    await auditLogService.createAuditLog({
      action: "duty_roster_shift_deleted",
      module: "duty_roster",
      target: context.rosterDate ?? "Duty roster shift",
      description: "Duty roster shift deleted.",
      outlet: context.outletId,
      before: context,
    }).catch(() => {});
  },

  async copyWeek({ outletId, sourceStartDate, sourceEndDate, targetDates, overwrite = false, targetStatus = "draft" }) {
    const sourceRows = await this.listDutyRosters(outletId, sourceStartDate, sourceEndDate);
    if (!sourceRows.length) return { created: 0, rows: [] };

    if (overwrite) {
      const { error: deleteError } = await supabase
        .from("duty_rosters")
        .delete()
        .eq("outlet_id", outletId)
        .gte("roster_date", targetDates[0])
        .lte("roster_date", targetDates[targetDates.length - 1]);
      throwSupabaseError("duty_rosters.copy_delete_existing", deleteError);
    }

    const dayBySourceDate = new Map(sourceRows.map((row) => [row.roster_date, row]));
    const sourceDates = [...new Set(sourceRows.map((row) => row.roster_date))].sort();
    const payload = [];
    sourceDates.forEach((sourceDate, sourceIndex) => {
      const targetDate = targetDates[sourceIndex];
      if (!targetDate) return;
      sourceRows
        .filter((row) => row.roster_date === sourceDate)
        .forEach((row) => {
          payload.push({
            outlet_id: outletId,
            employee_id: row.employee_id,
            roster_date: targetDate,
            shift_template_id: row.shift_template_id,
            start_time: row.start_time || null,
            end_time: row.end_time || null,
            break_minutes: row.break_minutes,
            status: targetStatus,
            remark: row.remark,
            updated_at: new Date().toISOString(),
          });
        });
    });

    if (!payload.length || !dayBySourceDate.size) return { created: 0, rows: [] };

    const { data, error } = await supabase
      .from("duty_rosters")
      .upsert(payload, { onConflict: "outlet_id,employee_id,roster_date" })
      .select(selectFields);

    throwSupabaseError("duty_rosters.copy_week", error);

    await auditLogService.createAuditLog({
      action: "duty_roster_week_copied",
      module: "duty_roster",
      target: `${targetDates[0]} duty roster`,
      description: "Duty roster week copied.",
      outlet: outletId,
      after: { source_week: sourceStartDate, target_week: targetDates[0], rows: payload.length, overwrite },
    }).catch(() => {});

    return { created: payload.length, rows: (data ?? []).map(mapRoster) };
  },

  async setWeekRosterStatus({ outletId, startDate, endDate, status, snapshots = [] }) {
    if (status === "published" && snapshots.length) {
      const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
      const updates = snapshots.map((snapshot) => supabase
        .from("duty_rosters")
        .update(buildPublishedPayload(status, snapshot))
        .eq("id", snapshot.id)
        .select(selectFields)
        .single());

      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      throwSupabaseError("duty_rosters.publish_snapshots", failed?.error ?? null);

      const publishedRows = results.map((result) => result.data).filter(Boolean);
      const missingSnapshotRows = [];
      if (publishedRows.length !== snapshotById.size) {
        const publishedIds = new Set(publishedRows.map((row) => row.id));
        snapshots.forEach((snapshot) => {
          if (!publishedIds.has(snapshot.id)) missingSnapshotRows.push(snapshot.id);
        });
      }
      if (missingSnapshotRows.length) {
        throw new Error("Some roster rows could not be published. Please refresh and try again.");
      }
      return publishedRows.map(mapRoster);
    }

    const { data, error } = await supabase
      .from("duty_rosters")
      .update(buildPublishedPayload(status))
      .eq("outlet_id", outletId)
      .gte("roster_date", startDate)
      .lte("roster_date", endDate)
      .select(selectFields);

    throwSupabaseError("duty_rosters.set_week_status", error);
    return (data ?? []).map(mapRoster);
  },
};
