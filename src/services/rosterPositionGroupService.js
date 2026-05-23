import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";

const selectFields = "id,position_id,group_name,created_at,updated_at";

function mapRow(row) {
  return {
    id: row.id,
    position_id: row.position_id,
    group_name: row.group_name ?? "other",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const rosterPositionGroupService = {
  async listMappings() {
    const { data, error } = await supabase
      .from("roster_position_groups")
      .select(selectFields);
    throwSupabaseError("roster_position_groups.list", error);
    return (data ?? []).map(mapRow);
  },

  async saveMapping({ position_id, group_name }) {
    const { data, error } = await supabase
      .from("roster_position_groups")
      .upsert({
        position_id,
        group_name,
        updated_at: new Date().toISOString(),
      }, { onConflict: "position_id" })
      .select(selectFields)
      .single();
    throwSupabaseError("roster_position_groups.save", error);
    return mapRow(data);
  },
};
