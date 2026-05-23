import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

const selectFields = "id,outlet_id,name,code,start_time,end_time,break_minutes,shift_type,color,sort_order,is_active,created_at,updated_at";
const templateOrder = new Map([
  ["MORNING", 1],
  ["MID", 2],
  ["CLOSING", 3],
  ["FULL", 4],
  ["OFF", 5],
  ["AL", 6],
  ["MC", 7],
]);

function mapTemplate(row) {
  return {
    id: row.id,
    outlet_id: row.outlet_id ?? null,
    name: row.name,
    code: row.code,
    start_time: row.start_time ?? "",
    end_time: row.end_time ?? "",
    break_minutes: Number(row.break_minutes || 0),
    shift_type: row.shift_type ?? "working",
    color: row.color ?? "green",
    sort_order: Number(row.sort_order ?? templateOrder.get(row.code) ?? 99),
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const shiftTemplateService = {
  async listShiftTemplates(outletId = "") {
    const query = supabase
      .from("shift_templates")
      .select(selectFields)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    const { data, error } = outletId
      ? await query.eq("outlet_id", outletId)
      : await query;

    throwSupabaseError("shift_templates.list", error);
    let rows = data ?? [];

    if (outletId && rows.length === 0) {
      const fallback = await supabase
        .from("shift_templates")
        .select(selectFields)
        .is("outlet_id", null)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      throwSupabaseError("shift_templates.fallback_list", fallback.error);
      rows = fallback.data ?? [];
    }

    return rows
      .map(mapTemplate)
      .sort((a, b) => (a.sort_order ?? templateOrder.get(a.code) ?? 99) - (b.sort_order ?? templateOrder.get(b.code) ?? 99) || a.name.localeCompare(b.name));
  },

  async listAllShiftTemplates(outletId = "") {
    let query = supabase
      .from("shift_templates")
      .select(selectFields)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    query = outletId ? query.eq("outlet_id", outletId) : query;
    const { data, error } = await query;
    throwSupabaseError("shift_templates.list_all", error);
    return (data ?? [])
      .map(mapTemplate)
      .sort((a, b) => (a.sort_order ?? templateOrder.get(a.code) ?? 99) - (b.sort_order ?? templateOrder.get(b.code) ?? 99) || a.name.localeCompare(b.name));
  },

  async saveShiftTemplate(template) {
    const payload = {
      outlet_id: template.outlet_id,
      name: template.name,
      code: String(template.code || template.name).trim().toUpperCase().replace(/\s+/g, "_"),
      start_time: template.start_time || null,
      end_time: template.end_time || null,
      break_minutes: Number(template.break_minutes || 0),
      shift_type: template.shift_type || "working",
      color: template.color || "green",
      sort_order: Number(template.sort_order || 0),
      is_active: template.is_active !== false,
      updated_at: new Date().toISOString(),
    };

    const query = template.id
      ? supabase.from("shift_templates").update(payload).eq("id", template.id)
      : supabase.from("shift_templates").insert(payload);

    const { data, error } = await query.select(selectFields).single();
    throwSupabaseError("shift_templates.save", error);
    return mapTemplate(data);
  },

  async deactivateShiftTemplate(id) {
    const { data, error } = await supabase
      .from("shift_templates")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(selectFields)
      .single();
    throwSupabaseError("shift_templates.deactivate", error);
    return mapTemplate(data);
  },

  async reorderShiftTemplates(templates = []) {
    const updates = templates.map((template, index) => ({
      id: template.id,
      sort_order: index + 1,
      updated_at: new Date().toISOString(),
    }));

    await Promise.all(updates.map(async (update) => {
      const { error } = await supabase
        .from("shift_templates")
        .update({ sort_order: update.sort_order, updated_at: update.updated_at })
        .eq("id", update.id);
      throwSupabaseError("shift_templates.reorder", error);
    }));

    return templates.map((template, index) => ({ ...template, sort_order: index + 1 }));
  },
};
