import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

const baseSelectFields = "id,outlet_id,name,code,start_time,end_time,break_minutes,shift_type,color,is_active,created_at,updated_at";
const selectFields = `${baseSelectFields},sort_order`;
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

function sortTemplates(rows) {
  return (rows ?? [])
    .map(mapTemplate)
    .sort((a, b) => (a.sort_order ?? templateOrder.get(a.code) ?? 99) - (b.sort_order ?? templateOrder.get(b.code) ?? 99) || a.name.localeCompare(b.name));
}

function missingSortOrder(error) {
  return error?.code === "42703" || error?.code === "PGRST204" || /sort_order/i.test(error?.message || "");
}

function orderingSetupError(error) {
  const next = new Error("Shift template ordering is not ready yet. Please apply the latest roster setup and refresh.");
  next.cause = error;
  return next;
}

async function runTemplateList({ outletId = "", activeOnly = false, includeSort = true }) {
  let query = supabase
    .from("shift_templates")
    .select(includeSort ? selectFields : baseSelectFields);

  if (activeOnly) query = query.eq("is_active", true);
  if (outletId) query = query.eq("outlet_id", outletId);
  if (includeSort) query = query.order("sort_order", { ascending: true });
  query = query.order("name", { ascending: true });

  return query;
}

export const shiftTemplateService = {
  async listShiftTemplates(outletId = "") {
    if (!outletId) return [];
    let { data, error } = await runTemplateList({ outletId, activeOnly: true });
    if (missingSortOrder(error)) {
      console.warn("shift_templates.sort_order is not available yet; loading templates without custom order.", error);
      ({ data, error } = await runTemplateList({ outletId, activeOnly: true, includeSort: false }));
    }

    throwSupabaseError("shift_templates.list", error);
    return sortTemplates(data);
  },

  async listAllShiftTemplates(outletId = "") {
    if (!outletId) return [];
    let { data, error } = await runTemplateList({ outletId });
    if (missingSortOrder(error)) {
      console.warn("shift_templates.sort_order is not available yet; loading all templates without custom order.", error);
      ({ data, error } = await runTemplateList({ outletId, includeSort: false }));
    }
    throwSupabaseError("shift_templates.list_all", error);
    return sortTemplates(data);
  },

  async saveShiftTemplate(template) {
    if (!template.outlet_id) {
      throw new Error("Select an outlet before saving shift templates.");
    }

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

    let { data, error } = await query.select(selectFields).single();
    if (missingSortOrder(error)) throw orderingSetupError(error);
    throwSupabaseError("shift_templates.save", error);
    return mapTemplate(data);
  },

  async deactivateShiftTemplate(id) {
    let { data, error } = await supabase
      .from("shift_templates")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(selectFields)
      .single();
    if (missingSortOrder(error)) throw orderingSetupError(error);
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
      if (missingSortOrder(error)) throw orderingSetupError(error);
      throwSupabaseError("shift_templates.reorder", error);
    }));

    return templates.map((template, index) => ({ ...template, sort_order: index + 1 }));
  },
};
