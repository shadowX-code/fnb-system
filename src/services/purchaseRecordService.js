import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

export const purchaseRecordService = {
  async getPurchaseRecords(outletId, year, month) {
    const { data, error } = await supabase
      .from("purchase_records")
      .select("id,outlet_id,year,month,supplier_id,category_id,amount,remark,created_at,updated_at")
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month)
      .order("amount", { ascending: false });

    throwSupabaseError("purchase_records.list", error);
    return data ?? [];
  },

  async deletePurchaseRecords(outletId, year, month) {
    const existing = await this.getPurchaseRecords(outletId, year, month);
    await this.deletePurchaseRecordIds(existing.map((record) => record.id));
  },

  async deletePurchaseRecordIds(ids) {
    if (!ids.length) return;
    const { error } = await supabase
      .from("purchase_records")
      .delete()
      .in("id", ids);

    throwSupabaseError("purchase_records.delete_removed_rows", error);
  },

  async savePurchaseRecords(outletId, year, month, records) {
    const existing = await this.getPurchaseRecords(outletId, year, month);
    const existingById = new Map(existing.map((record) => [record.id, record]));
    const seenExistingIds = new Set();
    const savedRows = [];

    const payload = records.map((record) => ({
      id: record.id,
      outlet_id: outletId,
      year,
      month,
      supplier_id: record.supplier_id || null,
      category_id: record.category_id || null,
      amount: Number(record.amount) || 0,
      remark: record.remark ?? "",
    }));

    if (!payload.length) return [];

    for (const row of payload) {
      if (row.id && existingById.has(row.id)) {
        seenExistingIds.add(row.id);
        const { id, ...updatePayload } = row;
        const { data, error } = await supabase
          .from("purchase_records")
          .update({ ...updatePayload, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select("id,outlet_id,year,month,supplier_id,category_id,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("purchase_records.update_row", error);
        savedRows.push(data);
      } else {
        const { id: _ignoredId, ...insertPayload } = row;
        const { data, error } = await supabase
          .from("purchase_records")
          .insert(insertPayload)
          .select("id,outlet_id,year,month,supplier_id,category_id,amount,remark,created_at,updated_at")
          .single();
        throwSupabaseError("purchase_records.insert_row", error);
        savedRows.push(data);
      }
    }

    const removedIds = existing.map((record) => record.id).filter((id) => !seenExistingIds.has(id));
    await this.deletePurchaseRecordIds(removedIds);

    await auditLogService.createAuditLog({
      action: "purchase_updated",
      module: "purchases",
      target: `${month}/${year} purchase records`,
      description: "Monthly purchase records saved.",
      outlet: outletId,
      after: { rows: savedRows.length },
    }).catch(() => {});
    console.info("[Supabase:purchase_records.save] Saved to Supabase", { outletId, year, month, rows: savedRows.length });
    return savedRows;
  },
};
