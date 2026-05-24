import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const selectFields = "id,outlet_id,week_start_date,week_end_date,status,published_by,published_at,locked_at,created_at,updated_at";

function mapPeriod(row) {
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    week_start_date: row.week_start_date,
    week_end_date: row.week_end_date,
    status: row.status ?? "draft",
    published_by: row.published_by,
    published_at: row.published_at,
    locked_at: row.locked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const rosterPeriodService = {
  async listRosterPeriods(outletId, startDate, endDate) {
    const { data, error } = await supabase
      .from("roster_periods")
      .select(selectFields)
      .eq("outlet_id", outletId)
      .lte("week_start_date", endDate)
      .gte("week_end_date", startDate)
      .order("week_start_date", { ascending: true });

    throwSupabaseError("roster_periods.list", error);
    return (data ?? []).map(mapPeriod);
  },

  async getOrCreateRosterPeriod(outletId, weekStartDate, weekEndDate) {
    const { data: existing, error: existingError } = await supabase
      .from("roster_periods")
      .select(selectFields)
      .eq("outlet_id", outletId)
      .eq("week_start_date", weekStartDate)
      .maybeSingle();

    throwSupabaseError("roster_periods.get", existingError);
    if (existing) return mapPeriod(existing);

    const { data, error } = await supabase
      .from("roster_periods")
      .insert({
        outlet_id: outletId,
        week_start_date: weekStartDate,
        week_end_date: weekEndDate,
        status: "draft",
      })
      .select(selectFields)
      .single();

    throwSupabaseError("roster_periods.create", error);
    return mapPeriod(data);
  },

  async setRosterPeriodStatus(period, status) {
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const payload = {
      status,
      updated_at: now,
      ...(status === "published" ? { published_by: userData?.user?.id ?? null, published_at: now, locked_at: null } : {}),
      ...(status === "locked" ? { locked_at: now } : {}),
      ...(status === "draft" ? { locked_at: null } : {}),
    };

    const { data, error } = await supabase
      .from("roster_periods")
      .update(payload)
      .eq("id", period.id)
      .select(selectFields)
      .single();

    throwSupabaseError("roster_periods.set_status", error);

    const action = status === "published"
      ? "duty_roster_published"
      : status === "locked"
        ? "duty_roster_locked"
        : "duty_roster_unlocked";

    await auditLogService.createAuditLog({
      action,
      module: "duty_roster",
      target: `${period.week_start_date} duty roster`,
      description: status === "published" ? "Duty roster published." : status === "locked" ? "Duty roster locked." : "Duty roster unlocked.",
      outlet: period.outlet_id,
      after: { status },
    }).catch(() => {});

    return mapPeriod(data);
  },
};
