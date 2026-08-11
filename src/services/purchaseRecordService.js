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

  async savePurchaseRecords(outletId, year, month, records, requestId) {
    const rows = records.map((record) => ({
      supplier_id: record.supplier_id || null,
      category_id: record.category_id || null,
      amount: Number(record.amount) || 0,
      remark: record.remark ?? "",
    }));
    logPurchaseRecordQuery("rpc:save_period_snapshot", "purchase_input.create OR purchase_input.edit", { outletId, year, month, rows: rows.length });
    const { data, error } = await supabase.rpc("save_purchase_period_snapshot", {
      p_request_id: requestId, p_outlet_id: outletId, p_year: year, p_month: month, p_rows: rows,
    });
    throwSupabaseError("purchase_records.save_period_snapshot", error);
    const savedRows = data?.records ?? [];

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
