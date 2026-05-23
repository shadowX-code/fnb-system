import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

const selectFields = "id,name,code,start_time,end_time,break_minutes,shift_type,color,is_active,created_at,updated_at";

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    start_time: row.start_time ?? "",
    end_time: row.end_time ?? "",
    break_minutes: Number(row.break_minutes || 0),
    shift_type: row.shift_type ?? "working",
    color: row.color ?? "green",
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const shiftTemplateService = {
  async listShiftTemplates() {
    const { data, error } = await supabase
      .from("shift_templates")
      .select(selectFields)
      .eq("is_active", true)
      .order("name", { ascending: true });

    throwSupabaseError("shift_templates.list", error);
    return (data ?? []).map(mapTemplate);
  },
};
