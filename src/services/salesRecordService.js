import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

export const salesRecordService = {
  async getSalesRecords(outletId, year, month) {
    const { data, error } = await supabase
      .from("sales_records")
      .select("id,outlet_id,year,month,channel_name,amount,remark")
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month)
      .order("channel_name", { ascending: true });

    throwSupabaseError("sales_records.list", error);

    return data ?? [];
  },

  async deleteSalesRecords(outletId, year, month) {
    const { error } = await supabase
      .from("sales_records")
      .delete()
      .eq("outlet_id", outletId)
      .eq("year", year)
      .eq("month", month);

    throwSupabaseError("sales_records.delete_period", error);
  },

  async saveSalesRecords(outletId, year, month, records) {
    await this.deleteSalesRecords(outletId, year, month);

    const payload = records.map((record) => ({
      outlet_id: outletId,
      year,
      month,
      channel_name: record.channel_name,
      amount: Number(record.amount) || 0,
      remark: record.remark ?? "",
    }));

    if (!payload.length) return [];

    const { data, error } = await supabase
      .from("sales_records")
      .insert(payload)
      .select("id,outlet_id,year,month,channel_name,amount,remark");

    throwSupabaseError("sales_records.insert_period", error);

    await auditLogService.createAuditLog({
      action: "sales_updated",
      module: "sales",
      target: `${month}/${year} sales records`,
      description: "Monthly sales records saved.",
      outlet: outletId,
      after: { rows: data?.length ?? 0 },
    }).catch(() => {});

    return data ?? [];
  },
};
