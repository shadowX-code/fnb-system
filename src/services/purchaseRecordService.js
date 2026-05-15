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
    const { error } = await supabase
      .from("purchase_records")
      .delete()
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month);

    throwSupabaseError("purchase_records.delete_period", error);
  },

  async savePurchaseRecords(outletId, year, month, records) {
    await this.deletePurchaseRecords(outletId, year, month);
    const payload = records.map((record) => ({
      outlet_id: outletId,
      year,
      month,
      supplier_id: record.supplier_id || null,
      category_id: record.category_id || null,
      amount: Number(record.amount) || 0,
      remark: record.remark ?? "",
    }));

    if (!payload.length) return [];

    const { data, error } = await supabase
      .from("purchase_records")
      .insert(payload)
      .select("id,outlet_id,year,month,supplier_id,category_id,amount,remark,created_at,updated_at");

    throwSupabaseError("purchase_records.insert_period", error);
    await auditLogService.createAuditLog({
      action: "purchase_updated",
      module: "purchases",
      target: `${month}/${year} purchase records`,
      description: "Monthly purchase records saved.",
      outlet: outletId,
      after: { rows: data?.length ?? 0 },
    }).catch(() => {});
    return data ?? [];
  },
};
