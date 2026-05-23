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

  async saveMappings({ floorPositionIds = [], kitchenPositionIds = [], allPositionIds = [] }) {
    const selectedIds = [...new Set([...floorPositionIds, ...kitchenPositionIds])];
    const rows = [
      ...floorPositionIds.map((positionId) => ({
        position_id: positionId,
        group_name: "floor",
        updated_at: new Date().toISOString(),
      })),
      ...kitchenPositionIds.map((positionId) => ({
        position_id: positionId,
        group_name: "kitchen",
        updated_at: new Date().toISOString(),
      })),
    ];

    if (allPositionIds.length) {
      const clearIds = allPositionIds.filter((positionId) => !selectedIds.includes(positionId));
      if (clearIds.length) {
        const { error: deleteError } = await supabase
          .from("roster_position_groups")
          .delete()
          .in("position_id", clearIds);
        throwSupabaseError("roster_position_groups.clear_unassigned", deleteError);
      }
    }

    if (rows.length) {
      const { error: upsertError } = await supabase
        .from("roster_position_groups")
        .upsert(rows, { onConflict: "position_id" });
      throwSupabaseError("roster_position_groups.bulk_save", upsertError);
    }

    return this.listMappings();
  },
};
