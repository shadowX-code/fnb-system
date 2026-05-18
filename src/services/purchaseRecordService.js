import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

function logPurchaseRecordQuery(operation, permission, context = {}) {
  if (!import.meta.env.DEV) return;
  console.info("[Supabase:purchase_records.query]", { operation, permission, ...context });
}

const purchaseRecordSelect = `
  id,
  outlet_id,
  year,
  month,
  supplier_id,
  category_id,
  amount,
  remark,
  created_at,
  updated_at,
  supplier:suppliers(id,name,default_category_id,category),
  category:purchase_categories(id,name)
`;

function mapPurchaseRecord(record) {
  return {
    id: record.id,
    outlet_id: record.outlet_id,
    year: record.year,
    month: record.month,
    supplier_id: record.supplier_id,
    category_id: record.category_id,
    amount: record.amount,
    remark: record.remark,
    created_at: record.created_at,
    updated_at: record.updated_at,
    supplier_name: record.supplier?.name ?? "",
    category_name: record.category?.name ?? record.supplier?.category ?? "",
  };
}

export const purchaseRecordService = {
  async listPurchaseRecords() {
    logPurchaseRecordQuery("select:list_all", "dashboard.view OR purchase_input.view OR purchase_comparison.view");
    const { data, error } = await supabase
      .from("purchase_records")
      .select(purchaseRecordSelect)
      .order("year", { ascending: true })
      .order("month", { ascending: true })
      .order("amount", { ascending: false });

    throwSupabaseError("purchase_records.list_all", error);
    return (data ?? []).map(mapPurchaseRecord);
  },

  async getPurchaseRecords(outletId, year, month) {
    logPurchaseRecordQuery("select:list_period", "purchase_input.view", { outletId, year, month });
    const { data, error } = await supabase
      .from("purchase_records")
      .select(purchaseRecordSelect)
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month)
      .order("amount", { ascending: false });

    throwSupabaseError("purchase_records.list", error);
    return (data ?? []).map(mapPurchaseRecord);
  },

  async getPurchaseRecordsForYear(outletId, year) {
    logPurchaseRecordQuery("select:list_year", "purchase_comparison.view OR dashboard.view", { outletId, year });
    const { data, error } = await supabase
      .from("purchase_records")
      .select(purchaseRecordSelect)
      .eq("outlet_id", outletId)
      .eq("year", year)
      .order("month", { ascending: true })
      .order("amount", { ascending: false });

    throwSupabaseError("purchase_records.list_year", error);
    return (data ?? []).map(mapPurchaseRecord);
  },

  async deletePurchaseRecords(outletId, year, month) {
    const existing = await this.getPurchaseRecords(outletId, year, month);
    await this.deletePurchaseRecordIds(existing.map((record) => record.id));
  },

  async deletePurchaseRecordIds(ids) {
    if (!ids.length) return;
    logPurchaseRecordQuery("delete:removed_rows", "purchase_input.delete OR data_import.import", { rows: ids.length });
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
        logPurchaseRecordQuery("update:row", "purchase_input.edit OR data_import.import", { id, outletId, year, month });
        const { data, error } = await supabase
          .from("purchase_records")
          .update({ ...updatePayload, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select(purchaseRecordSelect)
          .single();
        throwSupabaseError("purchase_records.update_row", error);
        savedRows.push(mapPurchaseRecord(data));
      } else {
        const { id: _ignoredId, ...insertPayload } = row;
        logPurchaseRecordQuery("insert:row", "purchase_input.create OR data_import.import", {
          outletId,
          year,
          month,
          supplier_id: insertPayload.supplier_id,
          category_id: insertPayload.category_id,
        });
        const { data, error } = await supabase
          .from("purchase_records")
          .insert(insertPayload)
          .select(purchaseRecordSelect)
          .single();
        throwSupabaseError("purchase_records.insert_row", error);
        savedRows.push(mapPurchaseRecord(data));
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
