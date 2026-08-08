import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Factory, Package, RefreshCw, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FactoryDashboardMonthPicker from "../components/dashboard/FactoryDashboardMonthPicker.jsx";
import FactoryDashboardUomSelect from "../components/dashboard/FactoryDashboardUomSelect.jsx";
import FactoryDashboardChartTooltip from "../components/dashboard/FactoryDashboardChartTooltip.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryDashboardQuery from "../hooks/useFactoryDashboardQuery.js";
import { dashboardActionTone, dashboardRequiredCheckLabel, dashboardTrendLabel, truncateDashboardChartLabel } from "../utils/factoryDashboardFormatters.js";
import { emptyFactoryDashboardAnalytics } from "../utils/factoryDashboardQuery.js";
import { canonicalDashboardUom, dashboardProductAxisLabel, dashboardUomOptions, selectedDashboardUom, toggleDashboardActionFilter, visibleDashboardActions } from "../utils/factoryDashboardState.js";
import { factoryMonthLabel, malaysiaBusinessMonthInput, shiftFactoryMonth } from "../utils/factoryDates.js";
import { quantity, percent } from "../utils/factoryFormatters.js";

function packSizeText(sku) { return Number(sku?.pack_size_qty || 0) > 0 ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`.trim() : ""; }
function jobFinishedGoodName(job) { return job?.finished_good?.product_name || job?.finished_good?.name_en || job?.product_name || "Finished Good"; }

export default function FactoryDashboardPage({ onRefreshFactoryData }) {
  const { finishedGoods } = useFactoryMasterData();
  const [dashboardMonth, setDashboardMonth] = useState(() => malaysiaBusinessMonthInput());
  const [dashboardFinishedGood, setDashboardFinishedGood] = useState("");
  const [dashboardProductionUom, setDashboardProductionUom] = useState("");
  const [dashboardProductionMeasure, setDashboardProductionMeasure] = useState("output");
  const [dashboardRawUom, setDashboardRawUom] = useState("");
  const [dashboardPlanUom, setDashboardPlanUom] = useState("");
  const [dashboardActionFilter, setDashboardActionFilter] = useState("all");
  const dashboard = useFactoryDashboardQuery({ month: dashboardMonth, finishedGoodId: dashboardFinishedGood });
  const dashboardAnalytics = dashboard.state;
  const loadDashboardAnalytics = dashboard.retry;
  const dashboardActions = <button className="btn-secondary" type="button" disabled={dashboardAnalytics.loading} onClick={() => Promise.all([onRefreshFactoryData?.(), loadDashboardAnalytics()])}><RefreshCw size={15} className={dashboardAnalytics.loading ? "animate-spin" : ""} /> Refresh</button>;
    function renderDashboard() {
    const snapshot = dashboardAnalytics.snapshot || emptyFactoryDashboardAnalytics();
    const permissions = snapshot.filters?.permissions || {};
    const loadedDashboardMonth = String(snapshot.filters?.month_start || "").slice(0, 7);
        const productionRows = Array.isArray(snapshot.production_summary) ? snapshot.production_summary.map((row) => {
      const uom = canonicalDashboardUom(row.uom_key || row.uom);
      return { ...row, uom, uom_key: uom, id: `${row.finished_good_id || "legacy"}-${uom}`, axis_label: dashboardProductAxisLabel(row) };
    }) : [];
    const dispatchRows = Array.isArray(snapshot.top_dispatch_products) ? snapshot.top_dispatch_products.map((row) => ({ ...row, id: row.finished_good_id || `dispatch-${row.rank}`, axis_label: dashboardProductAxisLabel(row) })) : [];
    const rawRows = Array.isArray(snapshot.top_raw_materials) ? snapshot.top_raw_materials.map((row, index) => {
      const uom = canonicalDashboardUom(row.uom_key || row.uom);
      return { ...row, uom, uom_key: uom, id: `${row.raw_material_id || index}-${uom}` };
    }) : [];
    const plannedRows = Array.isArray(snapshot.planned_vs_actual) ? snapshot.planned_vs_actual.map((row) => {
      const uom = canonicalDashboardUom(row.uom_key || row.uom);
      return { ...row, uom, uom_key: uom, id: `${row.finished_good_id || "legacy"}-${uom}`, axis_label: dashboardProductAxisLabel(row) };
    }) : [];
    const rawFlowRows = Array.isArray(snapshot.raw_material_flow) ? snapshot.raw_material_flow.map((row) => {
      const uom = canonicalDashboardUom(row.uom_key || row.uom);
      return { ...row, uom, uom_key: uom };
    }) : [];
    const actions = Array.isArray(snapshot.action_required) ? snapshot.action_required.map((row, index) => ({ ...row, id: `${row.severity || "Info"}-${row.alert || "Alert"}-${row.item || index}-${index}` })) : [];
    const productionUoms = dashboardUomOptions(productionRows);
    const selectedProductionUom = selectedDashboardUom(productionUoms, dashboardProductionUom);
    const rawUoms = dashboardUomOptions(rawRows);
    const selectedRawUom = selectedDashboardUom(rawUoms, dashboardRawUom);
    const productionForUom = productionRows
      .filter((row) => !selectedProductionUom || row.uom === selectedProductionUom)
      .sort((a, b) => Number(dashboardProductionMeasure === "batches" ? b.batch_count : b.output_qty) - Number(dashboardProductionMeasure === "batches" ? a.batch_count : a.output_qty)
        || String(a.product || "").localeCompare(String(b.product || ""))
        || String(a.finished_good_id || "").localeCompare(String(b.finished_good_id || "")));
    const productionChartRows = productionForUom.slice(0, 12);
    const rawChartRows = rawRows
      .filter((row) => !selectedRawUom || row.uom === selectedRawUom)
      .sort((a, b) => Number(b.received_qty) - Number(a.received_qty)
        || String(a.raw_material || "").localeCompare(String(b.raw_material || ""))
        || String(a.raw_material_id || "").localeCompare(String(b.raw_material_id || "")))
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const plannedUoms = dashboardUomOptions(plannedRows);
    const selectedPlanUom = selectedDashboardUom(plannedUoms, dashboardPlanUom);
    const plannedChartRows = plannedRows
      .filter((row) => !selectedPlanUom || row.uom === selectedPlanUom)
      .sort((a, b) => Number(b.planned_qty) - Number(a.planned_qty)
        || String(a.product || "").localeCompare(String(b.product || ""))
        || String(a.finished_good_id || "").localeCompare(String(b.finished_good_id || "")));
    const trend = snapshot.production_dispatch_trend || {};
    const trendMonths = Array.isArray(trend.months) ? trend.months : [];
    const productionTrend = trendMonths.map((month) => ({
      month: dashboardTrendLabel(month),
      quantity: (trend.production || []).filter((row) => row.month_start === month && (!selectedProductionUom || canonicalDashboardUom(row.uom_key || row.uom) === selectedProductionUom)).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    }));
    const dispatchTrend = trendMonths.map((month) => ({
      month: dashboardTrendLabel(month),
      quantity: (trend.dispatch || []).filter((row) => row.month_start === month).reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    }));
    const hasProductionTrendActivity = productionTrend.some((row) => Number(row.quantity || 0) > 0);
    const hasDispatchTrendActivity = dispatchTrend.some((row) => Number(row.quantity || 0) > 0);
    const trendSummary = (rows) => {
      const current = Number(rows.at(-1)?.quantity || 0);
      const previous = Number(rows.at(-2)?.quantity || 0);
      return { current, change: previous > 0 ? ((current - previous) * 100) / previous : null };
    };
    const productionTrendSummary = trendSummary(productionTrend);
    const dispatchTrendSummary = trendSummary(dispatchTrend);
    const qc = snapshot.qc_performance || {};
    const qcPassedCount = Number(snapshot.kpis.qc_pass_rate.passed || 0);
    const qcFailedCount = Number(snapshot.kpis.qc_pass_rate.failed || 0);
    const qcPendingCount = Number(snapshot.kpis.qc_pass_rate.pending || 0);
    const qcMetadataCount = Number(snapshot.kpis.qc_pass_rate.metadata_unavailable || 0);
    const qcCompletedCount = qcPassedCount + qcFailedCount;
        const qcKpiHelper = `${qcPassedCount} of ${qcCompletedCount} ${dashboardRequiredCheckLabel(qcCompletedCount)} passed · ${qcFailedCount} failed ${dashboardRequiredCheckLabel(qcFailedCount)} · ${qcPendingCount} pending ${dashboardRequiredCheckLabel(qcPendingCount)}`;
    const qcChartRows = [
      { name: "Pass", value: Number(qc.passed || 0), color: "#15803d" },
      { name: "Fail", value: Number(qc.failed || 0), color: "#be123c" },
      { name: "Pending", value: Number(qc.pending || 0), color: "#b45309" },
      { name: "Metadata unavailable", value: Number(qc.metadata_unavailable || 0), color: "#64748b" },
    ];
    const inventory = snapshot.inventory_health || {};
    const visibleActions = visibleDashboardActions(actions, dashboardActionFilter);
    const productOptions = finishedGoods
      .filter((item) => item.status === "active")
      .map((item) => ({ value: item.id, label: jobFinishedGoodName({ finished_good: item, product_name: item.product_name }), helper: `${item.product_code || "No SKU"} · ${item.variant_name || packSizeText(item) || "Packaging SKU"}` }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.helper.localeCompare(b.helper));
    const chartTooltipStyle = { border: "1px solid #d9e2dc", borderRadius: 8, boxShadow: "0 4px 8px rgba(15, 23, 42, 0.08)", fontSize: 12 };
                const metric = (Icon, label, value, helper, visible = true, tone = "neutral") => visible ? (
      <div key={label} className={`min-h-[112px] rounded-lg border bg-white p-3.5 ${tone === "danger" ? "border-rose-200" : tone === "warning" ? "border-amber-200" : "border-border"}`}>
        <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary"><Icon size={15} className="text-primary" />{label}</div>
        <div className="mt-3 break-words text-xl font-black text-text-primary">{value}</div>
        <div className="mt-1 text-xs font-medium leading-5 text-text-secondary">{helper}</div>
      </div>
    ) : null;

    if (!dashboardAnalytics.hasLoaded && dashboardAnalytics.loading) {
      return (
        <div className="space-y-5">
          <PageHeader section="Factory" title="Factory Dashboard" description="Monthly production, quality, purchasing and inventory performance." />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-lg bg-slate-100" />)}</div>
          <div className="grid gap-4 xl:grid-cols-3"><div className="h-96 animate-pulse rounded-lg bg-slate-100 xl:col-span-2" /><div className="h-96 animate-pulse rounded-lg bg-slate-100" /></div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Factory Dashboard"
          description={`Management analytics for ${factoryMonthLabel(loadedDashboardMonth || dashboardMonth)} using Malaysia business dates.`}
          actions={dashboardActions}
        />

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-3">
          <div className="min-w-[270px]">
            <div className="mb-1 text-xs font-semibold text-text-secondary">Month</div>
            <div className="flex h-10 items-center rounded-lg border border-border bg-white">
              <button className="flex h-full w-10 items-center justify-center text-text-secondary hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20" type="button" aria-label="Previous month" onClick={() => setDashboardMonth((current) => shiftFactoryMonth(current, -1))}><ChevronLeft size={16} /></button>
              <FactoryDashboardMonthPicker value={dashboardMonth} onChange={setDashboardMonth} />
              <button className="flex h-full w-10 items-center justify-center text-text-secondary hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20" type="button" aria-label="Next month" onClick={() => setDashboardMonth((current) => shiftFactoryMonth(current, 1))}><ChevronRight size={16} /></button>
            </div>
          </div>
          <button className="btn-secondary h-10" type="button" disabled={dashboardMonth === malaysiaBusinessMonthInput()} onClick={() => setDashboardMonth(malaysiaBusinessMonthInput())}>This Month</button>
          <div className="min-w-[260px] flex-1 lg:max-w-md">
            <div className="mb-1 text-xs font-semibold text-text-secondary">Finished Good / Packaging SKU</div>
            <SearchableSelect value={dashboardFinishedGood} options={[{ value: "", label: "All", helper: "All permitted products" }, ...productOptions]} placeholder="All" searchPlaceholder="Search product or SKU" onChange={setDashboardFinishedGood} />
          </div>
        </div>

        {dashboardAnalytics.error ? (
          <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm font-semibold ${dashboardAnalytics.errorKind === "permission" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-900"}`} role="alert">
            <span>{dashboardAnalytics.error}</span>
            {dashboardAnalytics.errorKind === "load" ? <button className="btn-secondary" type="button" onClick={loadDashboardAnalytics}>Retry</button> : null}
          </div>
        ) : null}

        {dashboardAnalytics.loading && dashboardAnalytics.hasLoaded ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900" role="status">
            Updating analytics for {factoryMonthLabel(dashboardMonth)}. Showing {factoryMonthLabel(loadedDashboardMonth)} until the refresh completes.
          </div>
        ) : null}

        {dashboardAnalytics.hasLoaded ? (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
              {metric(Factory, "Production Output", analyticsQuantityList(snapshot.kpis.production_output.by_uom), `${Number(snapshot.kpis.production_output.batch_count || 0).toLocaleString("en-MY")} completed batch(es)`, permissions.production)}
              {metric(Truck, "Dispatch Volume", quantity(snapshot.kpis.dispatch_volume.pack_qty, "packs"), `${Number(snapshot.kpis.dispatch_volume.dispatch_count || 0).toLocaleString("en-MY")} completed dispatch(es)`, permissions.dispatch)}
              {metric(CheckCircle2, "Production Completion", percent(snapshot.kpis.completion_rate.rate), `${Number(snapshot.kpis.completion_rate.completed_within_month_count || 0)} of ${Number(snapshot.kpis.completion_rate.eligible_due_count || 0)} due Job Orders completed within selected month`, permissions.job_orders)}
              {metric(ClipboardCheck, "QC Pass Rate", percent(snapshot.kpis.qc_pass_rate.rate), qcKpiHelper, permissions.qc, qcFailedCount ? "danger" : "neutral")}
              {metric(Package, "Raw Material Receiving", analyticsQuantityList(snapshot.kpis.raw_receiving.by_uom), `${Number(snapshot.kpis.raw_receiving.record_count || 0)} receipt(s) · ${Number(snapshot.kpis.raw_receiving.material_count || 0)} materials`, permissions.receiving)}
              {metric(AlertTriangle, "Inventory Alerts", Number(snapshot.kpis.inventory_alerts.low_stock || 0) + Number(snapshot.kpis.inventory_alerts.out_of_stock || 0) + Number(snapshot.kpis.inventory_alerts.expiring_soon || 0) + Number(snapshot.kpis.inventory_alerts.reconciliation_required || 0), `${Number(snapshot.kpis.inventory_alerts.out_of_stock || 0)} out · ${Number(snapshot.kpis.inventory_alerts.expiring_soon || 0)} expiring`, permissions.finished_inventory || permissions.raw_inventory, Number(snapshot.kpis.inventory_alerts.out_of_stock || 0) ? "danger" : "warning")}
            </div>

            {permissions.production ? <Card title="Production Summary" description="Completed Production output by product for the selected month." action={<div className="flex flex-wrap items-center gap-2"><FactoryDashboardUomSelect uoms={productionUoms} value={selectedProductionUom} onChange={setDashboardProductionUom} ariaLabel="Production Summary UOM" /><div className="flex rounded-lg border border-border p-0.5"><button className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${dashboardProductionMeasure === "output" ? "bg-primary text-white" : "text-text-secondary"}`} type="button" onClick={() => setDashboardProductionMeasure("output")}>Output Qty</button><button className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${dashboardProductionMeasure === "batches" ? "bg-primary text-white" : "text-text-secondary"}`} type="button" onClick={() => setDashboardProductionMeasure("batches")}>Batch Count</button></div></div>}>
              {productionChartRows.length ? <div className="p-4"><div className="h-[340px]" role="img" aria-label={`Production Summary horizontal bar chart in ${selectedProductionUom || "selected units"}`}><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><BarChart data={productionChartRows} layout="vertical" margin={{ left: 42, right: 28 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="axis_label" width={190} tick={{ fontSize: 11 }} tickFormatter={(value) => truncateDashboardChartLabel(value)} /><Tooltip content={<FactoryDashboardChartTooltip mode="production" />} /><Bar dataKey={dashboardProductionMeasure === "batches" ? "batch_count" : "output_qty"} fill="#167d5a" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></div> : <EmptyState title="No completed Production" description="No completed Production output matches this month and filter." />}
              <FactoryTable columns={[{ key: "product", label: "Product", render: (row) => <div><div className="font-bold text-text-primary">{row.product}</div><div className="text-xs text-text-secondary">{row.packaging_sku}</div></div> }, { key: "output", label: "Output Qty", render: (row) => quantity(row.output_qty, row.uom) }, { key: "batches", label: "Batches", render: (row) => Number(row.batch_count || 0).toLocaleString("en-MY") }, { key: "average", label: "Average Batch", render: (row) => quantity(row.average_batch_qty, row.uom) }, { key: "completion", label: "Completion Rate", render: (row) => percent(row.completion_rate) }]} rows={productionForUom} emptyTitle="No Production summary" emptyDescription="Completed Production will appear here." />
            </Card> : null}

            <div className="grid gap-4 xl:grid-cols-2">
              {permissions.dispatch ? <Card title="Top 10 Dispatched Products" description="Completed Dispatch quantity in pack units." >
                {dispatchRows.length ? <div className="p-4"><div className="h-[300px]" role="img" aria-label="Top 10 dispatched products horizontal ranking chart"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><BarChart data={dispatchRows} layout="vertical" margin={{ left: 34, right: 24 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="axis_label" width={160} tick={{ fontSize: 11 }} tickFormatter={(value) => truncateDashboardChartLabel(value, 28)} /><Tooltip content={<FactoryDashboardChartTooltip mode="dispatch" />} /><Bar dataKey="dispatch_qty" fill="#2563eb" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></div> : <EmptyState title="No completed Dispatches" description="Completed Dispatch activity will appear here." />}
                <FactoryTable columns={[{ key: "rank", label: "Rank", render: (row) => `#${row.rank}` }, { key: "product", label: "Product", render: (row) => <div><div className="font-bold text-text-primary">{row.product}</div><div className="text-xs text-text-secondary">{row.packaging_sku}</div></div> }, { key: "qty", label: "Dispatch Qty", render: (row) => quantity(row.dispatch_qty, "packs") }, { key: "dispatches", label: "Dispatches", render: (row) => row.dispatch_count }, { key: "customers", label: "Customers", render: (row) => row.customer_count }, { key: "share", label: "Share", render: (row) => percent(row.share_percent) }]} rows={dispatchRows} emptyTitle="No Dispatch ranking" emptyDescription="No completed Dispatches match this month." />
              </Card> : null}

              {permissions.receiving ? <Card title="Top Purchased Raw Materials" description="Received quantities are ranked within one compatible UOM." action={<FactoryDashboardUomSelect uoms={rawUoms} value={selectedRawUom} onChange={setDashboardRawUom} ariaLabel="Raw Material ranking UOM" />}>
                {rawChartRows.length ? <div className="p-4"><div className="h-[300px]" role="img" aria-label="Top purchased raw materials horizontal ranking chart by quantity"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><BarChart data={rawChartRows} layout="vertical" margin={{ left: 24, right: 24 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="raw_material" width={150} tick={{ fontSize: 11 }} tickFormatter={(value) => truncateDashboardChartLabel(value, 26)} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [quantity(value, selectedRawUom), "Received Qty"]} /><Bar dataKey="received_qty" fill="#7c3aed" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></div> : <EmptyState title="No receiving data" description="No receiving records match this month and UOM." />}
                <FactoryTable columns={[{ key: "rank", label: "Rank", render: (row) => `#${row.rank}` }, { key: "material", label: "Raw Material", render: (row) => row.raw_material }, { key: "qty", label: "Received Qty", render: (row) => quantity(row.received_qty, row.uom) }, { key: "records", label: "Receipts", render: (row) => row.receiving_count }, { key: "suppliers", label: "Suppliers", render: (row) => row.supplier_count }]} rows={rawChartRows} emptyTitle="No purchased materials" emptyDescription="No receiving records match the selected month." />
              </Card> : null}
            </div>

            {(permissions.job_orders && permissions.production) ? <Card title="Planned vs Actual Production" description="Due Job Order targets compared with completed output in one compatible UOM." action={<FactoryDashboardUomSelect uoms={plannedUoms} value={selectedPlanUom} onChange={setDashboardPlanUom} ariaLabel="Planned versus Actual UOM" />}>
              {plannedChartRows.length ? <div className="p-4"><div className="h-[340px]" role="img" aria-label={`Planned versus Actual Production in ${selectedPlanUom}`}><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><BarChart data={plannedChartRows.slice(0, 12)} layout="vertical" margin={{ left: 42, right: 28 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="axis_label" width={190} tick={{ fontSize: 11 }} tickFormatter={(value) => truncateDashboardChartLabel(value)} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value, name) => [quantity(value, selectedPlanUom), name === "planned_qty" ? "Planned Qty" : "Actual Qty"]} labelFormatter={(_, payload) => payload?.[0]?.payload ? dashboardProductAxisLabel(payload[0].payload) : "Product"} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar name="Planned Qty" dataKey="planned_qty" fill="#64748b" radius={[0, 4, 4, 0]} /><Bar name="Actual Qty" dataKey="actual_qty" fill="#167d5a" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></div> : <EmptyState title="No planned Production" description="No eligible Job Orders are due in this month and UOM." />}
              <FactoryTable columns={[{ key: "product", label: "Product", render: (row) => <div><div className="font-bold text-text-primary">{row.product}</div><div className="text-xs text-text-secondary">{row.packaging_sku}</div></div> }, { key: "planned", label: "Planned Qty", render: (row) => quantity(row.planned_qty, row.uom) }, { key: "actual", label: "Actual Qty", render: (row) => quantity(row.actual_qty, row.uom) }, { key: "variance", label: "Variance", render: (row) => quantity(row.variance, row.uom) }, { key: "completion", label: "Completion %", render: (row) => percent(row.completion_percent) }]} rows={plannedChartRows} emptyTitle="No planned Production" emptyDescription="Eligible due Job Orders will appear here." />
            </Card> : null}

            <div className="grid gap-4 xl:grid-cols-3">
              {(permissions.production || permissions.dispatch) ? <Card className="xl:col-span-2" title="Production vs Dispatch Trend" description="Separate UOM-safe series for the six months ending in the selected month.">
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  {permissions.production ? <div><div className="mb-3 flex items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">Production Output ({selectedProductionUom || "UOM"})</div><div className="text-xs text-text-secondary">Selected month: {quantity(productionTrendSummary.current, selectedProductionUom)}</div></div><Badge tone={productionTrendSummary.change !== null && productionTrendSummary.change < 0 ? "warning" : "neutral"}>{productionTrendSummary.change === null ? "MoM —" : `${productionTrendSummary.change >= 0 ? "+" : ""}${productionTrendSummary.change.toFixed(1)}% MoM`}</Badge></div>{hasProductionTrendActivity ? <div className="h-[230px]" role="img" aria-label={`Six month Production output trend in ${selectedProductionUom}`}><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><LineChart data={productionTrend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [quantity(value, selectedProductionUom), "Production"]} /><Line type="monotone" dataKey="quantity" stroke="#167d5a" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <EmptyState title="No production activity for this period." description="Completed Production output will appear when activity is recorded." />}</div> : null}
                  {permissions.dispatch ? <div><div className="mb-3 flex items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">Dispatch Volume (Packs)</div><div className="text-xs text-text-secondary">Selected month: {quantity(dispatchTrendSummary.current, "packs")}</div></div><Badge tone={dispatchTrendSummary.change !== null && dispatchTrendSummary.change < 0 ? "warning" : "neutral"}>{dispatchTrendSummary.change === null ? "MoM —" : `${dispatchTrendSummary.change >= 0 ? "+" : ""}${dispatchTrendSummary.change.toFixed(1)}% MoM`}</Badge></div>{hasDispatchTrendActivity ? <div className="h-[230px]" role="img" aria-label="Six month completed Dispatch trend in packs"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><LineChart data={dispatchTrend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [quantity(value, "packs"), "Dispatch"]} /><Line type="monotone" dataKey="quantity" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <EmptyState title="No dispatch activity for this period." description="Completed Dispatch activity will appear when records are available." />}</div> : null}
                </div>
              </Card> : null}

              {permissions.qc ? <Card title="QC Performance" description="Required-check outcomes; no raw QC responses are exposed.">
                <div className="p-4"><div className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-emerald-50 p-2.5"><div className="font-black text-emerald-800">{qcPassedCount}</div><div className="text-emerald-700">Passed</div></div><div className="rounded-lg bg-rose-50 p-2.5"><div className="font-black text-rose-800">{qcFailedCount}</div><div className="text-rose-700">Failed</div></div><div className="rounded-lg bg-amber-50 p-2.5"><div className="font-black text-amber-800">{qcPendingCount}</div><div className="text-amber-700">Pending</div></div><div className="rounded-lg bg-slate-100 p-2.5"><div className="font-black text-slate-800">{qcMetadataCount}</div><div className="text-slate-600">Metadata unavailable</div></div></div>{qcChartRows.some((row) => row.value > 0) ? <div className="h-[220px]" role="img" aria-label="Required QC check outcome distribution"><ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 1, height: 1 }}><PieChart><Pie data={qcChartRows} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>{qcChartRows.map((row) => <Cell key={row.name} fill={row.color} />)}</Pie><Tooltip contentStyle={chartTooltipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div> : <div className="py-5 text-center text-sm font-semibold text-text-secondary">No required QC check activity.</div>}<div className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs"><div><div className="font-bold text-text-primary">No QC Required</div><div className="text-text-secondary">{Number(qc.no_qc_required || 0)} Job Orders</div></div><div><div className="font-bold text-text-primary">Metadata unavailable</div><div className="text-text-secondary">{Number(qc.metadata_unavailable_jobs || 0)} Job Orders</div></div></div>{qcFailedCount === 0 && qcPendingCount === 0 ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">No QC issues this month</div> : null}{qcFailedCount > 0 ? <div className="mt-3 space-y-2">{(qc.top_failures || []).slice(0, 4).map((row) => <div key={`${row.qc_name}-${row.product}`} className="flex items-start justify-between gap-3 border-t border-border pt-2 text-xs"><div><div className="font-bold text-text-primary">{row.qc_name}</div><div className="text-text-secondary">{row.product}</div></div><Badge tone="danger">{row.count}</Badge></div>)}</div> : null}</div>
              </Card> : null}
            </div>

            {(permissions.receiving && permissions.production) ? <Card title="Raw Material Receiving vs Usage" description="Received quantity, completed Production usage and net movement kept separate by UOM.">
              {rawFlowRows.length ? <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{rawFlowRows.map((row) => <div key={row.uom} className="rounded-lg border border-border bg-white p-3"><div className="mb-3 flex items-center justify-between"><div className="text-sm font-black text-text-primary">{row.uom}</div><Badge tone={Number(row.net_movement || 0) < 0 ? "warning" : "neutral"}>Net {quantity(row.net_movement, row.uom)}</Badge></div><div className="grid grid-cols-2 gap-3 text-xs"><div><div className="text-text-secondary">Received Qty</div><div className="mt-1 text-base font-black text-emerald-700">{quantity(row.received_qty, row.uom)}</div></div><div><div className="text-text-secondary">Production Usage</div><div className="mt-1 text-base font-black text-blue-700">{quantity(row.production_usage_qty, row.uom)}</div></div></div></div>)}</div> : <EmptyState title="No Raw Material movement" description="Receiving and completed Production usage will appear here by UOM." />}
            </Card> : null}

            {(permissions.finished_inventory || actions.length) ? <Card title="Inventory Health & Factory Action Required" description="Current authoritative inventory health and prioritized operational follow-up.">
              {permissions.finished_inventory ? <div className="flex flex-wrap border-b border-border bg-slate-50 px-4 py-3">
                <div className="min-w-[150px] flex-1 rounded-lg px-3 py-2 text-left" aria-label="Healthy SKUs, informational"><div className="text-xl font-black text-emerald-700">{Number(inventory.healthy || 0).toLocaleString("en-MY")}</div><div className="text-xs font-semibold text-text-secondary">Healthy SKUs</div><div className="text-[10px] font-semibold text-text-muted">Informational</div></div>
                {[
                ["low", "Low Stock", inventory.low_stock, "text-amber-700"],
                ["out", "Out of Stock", inventory.out_of_stock, "text-rose-700"],
                ["expiring", "Expiring in 30 Days", inventory.expiring_30_days, "text-amber-700"],
                ["reconciliation", "Reconciliation Required", inventory.reconciliation_required, "text-rose-700"],
              ].map(([filter, label, value, color]) => <button key={label} className={`min-w-[150px] flex-1 rounded-lg px-3 py-2 text-left outline-none transition hover:bg-white focus:ring-2 focus:ring-primary/20 ${dashboardActionFilter === filter ? "bg-white shadow-sm ring-1 ring-border" : ""}`} type="button" aria-pressed={dashboardActionFilter === filter} onClick={() => setDashboardActionFilter((current) => toggleDashboardActionFilter(current, filter))}><div className={`text-xl font-black ${color}`}>{Number(value || 0).toLocaleString("en-MY")}</div><div className="text-xs font-semibold text-text-secondary">{label}</div></button>)}</div> : null}
              {dashboardActionFilter !== "all" ? <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs font-semibold text-text-secondary"><span>Filtered by {dashboardActionFilter === "healthy" ? "Healthy SKUs" : dashboardActionFilter.replace(/\b\w/g, (letter) => letter.toUpperCase())}</span><button className="font-bold text-primary hover:underline" type="button" onClick={() => setDashboardActionFilter("all")}>Clear filter</button></div> : null}
              <FactoryTable columns={[{ key: "severity", label: "Severity", render: (row) => <Badge tone={dashboardActionTone(row.severity)}>{row.severity}</Badge> }, { key: "alert", label: "Alert", render: (row) => <div className="font-bold text-text-primary">{row.alert}</div> }, { key: "item", label: "Item", render: (row) => row.item }, { key: "details", label: "Details", render: (row) => <div className="max-w-[320px] text-text-secondary">{row.details}</div> }, { key: "recommended", label: "Recommended Action", render: (row) => String(row.recommended_action || "Review and resolve.").replace(/^Open /, "Review ") }, { key: "link", label: "Link", render: (row) => { const route = row.route || row.link; if (!route) return "—"; const target = row.detail_id ? `${route}?detail_id=${encodeURIComponent(row.detail_id)}&entity_type=${encodeURIComponent(row.entity_type || "")}` : route; return <a className="font-bold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/20" href={target}>Open</a>; } }]} rows={visibleActions} emptyTitle="No action required" emptyDescription="No permitted operational alerts match this view." />
            </Card> : null}
          </>
        ) : dashboardAnalytics.errorKind === "permission" ? <EmptyState title="Factory Dashboard unavailable" description="Your current role does not include Factory Dashboard analytics." /> : null}
      </div>
    );
  }

  return renderDashboard();
}
