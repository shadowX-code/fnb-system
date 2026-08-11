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

  async saveSalesRecords(outletId, year, month, records, requestId) {
    const rows = records.map((record) => ({
      channel_id: record.channel_id || null,
      channel_name: record.channel_name,
      amount: Number(record.amount) || 0,
      remark: record.remark ?? "",
    }));

    logSalesRecordQuery("rpc:save_period_snapshot", "sales_input.create OR sales_input.edit", {
      outletId,
      year,
      month,
      rows: rows.length,
    });
    const { data, error } = await supabase
      .rpc("save_sales_period_snapshot", {
        p_request_id: requestId,
        p_outlet_id: outletId,
        p_year: year,
        p_month: month,
        p_rows: rows,
      });
    throwSupabaseError("sales_records.save_period_snapshot", error);

    const savedRows = data?.records ?? [];

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
