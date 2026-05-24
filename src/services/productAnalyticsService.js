import { supabase } from "../lib/supabase";
import { auditLogService } from "./auditLogService";
import { throwSupabaseError } from "./supabaseError";

const reportFields = "id,outlet_id,report_month,report_year,file_name,uploaded_by,uploaded_at,status,total_net_sales,total_quantity,total_discount,raw_metadata";
const itemFields = "id,report_id,outlet_id,category_name,product_name,variant_name,quantity,gross_sales,discount,sst,service_charge,nett_sales,created_at";

function mapReport(row) {
  return {
    id: row.id,
    outlet_id: row.outlet_id,
    report_month: Number(row.report_month),
    report_year: Number(row.report_year),
    file_name: row.file_name,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at,
    status: row.status ?? "completed",
    total_net_sales: Number(row.total_net_sales ?? 0),
    total_quantity: Number(row.total_quantity ?? 0),
    total_discount: Number(row.total_discount ?? 0),
    raw_metadata: row.raw_metadata ?? {},
  };
}

function mapItem(row) {
  return {
    id: row.id,
    report_id: row.report_id,
    outlet_id: row.outlet_id,
    category_name: row.category_name ?? "Uncategorized",
    product_name: row.product_name ?? "",
    variant_name: row.variant_name ?? "",
    quantity: Number(row.quantity ?? 0),
    gross_sales: Number(row.gross_sales ?? 0),
    discount: Number(row.discount ?? 0),
    sst: Number(row.sst ?? 0),
    service_charge: Number(row.service_charge ?? 0),
    nett_sales: Number(row.nett_sales ?? 0),
    created_at: row.created_at,
  };
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

export const productAnalyticsService = {
  async listReports({ outletIds = [] } = {}) {
    let query = supabase
      .from("product_sales_reports")
      .select(reportFields)
      .order("report_year", { ascending: false })
      .order("report_month", { ascending: false })
      .order("uploaded_at", { ascending: false });
    if (outletIds.length) query = query.in("outlet_id", outletIds);
    const { data, error } = await query;
    throwSupabaseError("product_sales_reports.list", error);
    return (data ?? []).map(mapReport);
  },

  async listItemsByReportIds(reportIds = []) {
    if (!reportIds.length) return [];
    const { data, error } = await supabase
      .from("product_sales_items")
      .select(itemFields)
      .in("report_id", reportIds)
      .order("nett_sales", { ascending: false });
    throwSupabaseError("product_sales_items.list_by_reports", error);
    return (data ?? []).map(mapItem);
  },

  async findReport(outletId, month, year) {
    const { data, error } = await supabase
      .from("product_sales_reports")
      .select(reportFields)
      .eq("outlet_id", outletId)
      .eq("report_month", month)
      .eq("report_year", year)
      .maybeSingle();
    throwSupabaseError("product_sales_reports.find", error);
    return data ? mapReport(data) : null;
  },

  async replaceReport({ outletId, month, year, fileName, items, existingReportId = null, metadata = {} }) {
    const uploadedBy = await currentUserId();
    const totals = items.reduce((sum, item) => ({
      quantity: sum.quantity + Number(item.quantity || 0),
      netSales: sum.netSales + Number(item.nett_sales || 0),
      discount: sum.discount + Number(item.discount || 0),
    }), { quantity: 0, netSales: 0, discount: 0 });

    if (existingReportId) {
      const { error: deleteError } = await supabase
        .from("product_sales_reports")
        .delete()
        .eq("id", existingReportId);
      throwSupabaseError("product_sales_reports.replace_delete", deleteError);
    }

    const { data: report, error: reportError } = await supabase
      .from("product_sales_reports")
      .insert({
        outlet_id: outletId,
        report_month: month,
        report_year: year,
        file_name: fileName,
        uploaded_by: uploadedBy,
        status: "completed",
        total_net_sales: totals.netSales,
        total_quantity: totals.quantity,
        total_discount: totals.discount,
        raw_metadata: metadata,
      })
      .select(reportFields)
      .single();
    throwSupabaseError("product_sales_reports.insert", reportError);

    const rows = items.map((item) => ({
      report_id: report.id,
      outlet_id: outletId,
      category_name: item.category_name,
      product_name: item.product_name,
      variant_name: item.variant_name || null,
      quantity: Number(item.quantity || 0),
      gross_sales: Number(item.gross_sales || 0),
      discount: Number(item.discount || 0),
      sst: Number(item.sst || 0),
      service_charge: Number(item.service_charge || 0),
      nett_sales: Number(item.nett_sales || 0),
    }));

    if (rows.length) {
      const { error: itemError } = await supabase.from("product_sales_items").insert(rows);
      throwSupabaseError("product_sales_items.insert", itemError);
    }

    await auditLogService.createAuditLog({
      action: existingReportId ? "product_sales_report_replaced" : "product_sales_report_uploaded",
      module: "product_analytics",
      target: fileName,
      outlet: outletId,
      description: existingReportId ? "Product sales report replaced." : "Product sales report uploaded.",
      after: { outlet_id: outletId, report_month: month, report_year: year, rows: rows.length, total_net_sales: totals.netSales },
    }).catch(() => {});

    return mapReport(report);
  },

  async deleteReport(report) {
    const { error } = await supabase
      .from("product_sales_reports")
      .delete()
      .eq("id", report.id);
    throwSupabaseError("product_sales_reports.delete", error);
    await auditLogService.createAuditLog({
      action: "product_sales_report_deleted",
      module: "product_analytics",
      target: report.file_name,
      outlet: report.outlet_id,
      description: "Product sales report deleted.",
      before: report,
    }).catch(() => {});
    return true;
  },
};
