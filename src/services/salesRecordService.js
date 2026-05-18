import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function logSalesRecordQuery(operation, permission, context = {}) {
  if (!import.meta.env.DEV) return;
  console.info("[Supabase:sales_records.query]", { operation, permission, ...context });
}

export const salesRecordService = {
  async listSalesRecords() {
    logSalesRecordQuery("select:list_all", "dashboard.view OR sales_input.view OR sales_comparison.view");
    const { data, error } = await supabase
      .from("sales_records")
      .select("id,outlet_id,year,month,channel_id,channel_name,amount,remark,created_at,updated_at")
      .order("year", { ascending: true })
      .order("month", { ascending: true })
      .order("channel_name", { ascending: true });

    throwSupabaseError("sales_records.list_all", error);
    return data ?? [];
  },

  async getSalesRecords(outletId, year, month) {
    logSalesRecordQuery("select:list_period", "sales_input.view", { outletId, year, month });
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
    logSalesRecordQuery("select:list_year", "sales_comparison.view OR dashboard.view", { outletId, year });
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
    logSalesRecordQuery("select:list_existing", "sales_input.view", { outletId, year, month });
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
    logSalesRecordQuery("delete:removed_rows", "sales_input.delete OR data_import.import", { rows: ids.length });
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
        logSalesRecordQuery("update:row", "sales_input.edit OR data_import.import", { id, outletId, year, month });
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
        logSalesRecordQuery("insert:row", "sales_input.create OR data_import.import", {
          outletId,
          year,
          month,
          channel_id: insertPayload.channel_id,
          channel_name: insertPayload.channel_name,
        });
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
