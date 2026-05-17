import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

export const salesRecordService = {
  async getSalesRecords(outletId, year, month) {
    const { data, error } = await supabase
      .from("sales_records")
      .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month)
      .order("channel_name", { ascending: true });

    throwSupabaseError("sales_records.list", error);

    return data ?? [];
  },

  async getSalesRecordsForYear(outletId, year) {
    const { data, error } = await supabase
      .from("sales_records")
      .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
      .eq("outlet_id", outletId)
      .eq("year", year)
      .order("month", { ascending: true })
      .order("channel_name", { ascending: true });

    throwSupabaseError("sales_records.list_year", error);
    return data ?? [];
  },

  async listExistingSalesRecords(outletId, year, month) {
    const { data, error } = await supabase
      .from("sales_records")
      .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark")
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month);

    throwSupabaseError("sales_records.list_existing", error);
    return data ?? [];
  },

  async deleteSalesRecordIds(ids) {
    if (!ids.length) return;
    const { error } = await supabase
      .from("sales_records")
      .delete()
      .in("id", ids);

    throwSupabaseError("sales_records.delete_removed_rows", error);
  },

  async deleteSalesRecords(outletId, year, month) {
    const existing = await this.listExistingSalesRecords(outletId, year, month);
    await this.deleteSalesRecordIds(existing.map((record) => record.id));
  },

  async saveSalesRecords(outletId, year, month, records) {
    const existing = await this.listExistingSalesRecords(outletId, year, month);
    const existingById = new Map(existing.map((record) => [record.id, record]));
    const seenExistingIds = new Set();
    const savedRows = [];

    const payload = records.map((record) => ({
      id: record.id,
      outlet_id: outletId,
      year,
      month,
      channel_id: record.channel_id || null,
      channel_name: record.channel_name,
      amount: Number(record.amount) || 0,
      remark: record.remark ?? "",
    }));

    if (!payload.length) return [];

    for (const row of payload) {
      if (row.id && existingById.has(row.id)) {
        seenExistingIds.add(row.id);
        const { id, ...updatePayload } = row;
        const { data, error } = await supabase
          .from("sales_records")
          .update({ ...updatePayload, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("sales_records.update_row", error);
        savedRows.push(data);
      } else {
        const { id: _ignoredId, ...insertPayload } = row;
        const { data, error } = await supabase
          .from("sales_records")
          .insert(insertPayload)
          .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("sales_records.insert_row", error);
        savedRows.push(data);
      }
    }

    const removedIds = existing.map((record) => record.id).filter((id) => !seenExistingIds.has(id));
    await this.deleteSalesRecordIds(removedIds);

    await auditLogService.createAuditLog({
      action: "sales_updated",
      module: "sales",
      target: `${month}/${year} sales records`,
      description: "Monthly sales records saved.",
      outlet: outletId,
      after: { rows: savedRows.length },
    }).catch(() => {});

    console.info("[Supabase:sales_records.save] Saved to Supabase", { outletId, year, month, rows: savedRows.length });
    return savedRows;
  },
};
