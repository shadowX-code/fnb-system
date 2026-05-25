import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import {
  buildAlerts,
  buildMonthlySummary,
  getCategoryName,
  getPreviousPeriod,
  getSupplierPurchaseAmount,
  getSupplierName,
  percentageChange,
  sumAmount,
  toCurrency,
  toPercent,
} from "../utils/analytics.js";

function formatAlertValue(alert, value) {
  if (["cogs_margin_critical", "cogs_margin_high", "cogs_margin_watch", "sst_unusual", "delivery_platform_dependency_high"].includes(alert.alert_type)) {
    return toPercent(Number(value));
  }
  return toCurrency(value);
}

function SkeletonBlock({ className = "" }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-100 ${className}`} />;
}

function MetricSkeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {[1, 2, 3, 4, 5].map((item) => (
        <SkeletonBlock key={item} className="h-24" />
      ))}
    </div>
  );
}

function ChartSkeleton({ title, description }) {
  return (
    <Card title={title} description={description}>
      <div className="p-5">
        <SkeletonBlock className="h-56" />
      </div>
    </Card>
  );
}

export default function SPDashboardPage({ store }) {
  const filters = usePeriodFilters(store);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return undefined;
    }
    setIsLoading(true);
    const timer = window.setTimeout(() => setIsLoading(false), 280);
    return () => window.clearTimeout(timer);
  }, [filters.month, filters.outletId, filters.year]);
  const monthly = useMemo(
    () =>
      buildMonthlySummary({
        salesRecords: store.salesRecords,
        salesChannels: store.salesChannels,
        purchaseRecords: store.purchaseRecords,
        outletId: filters.outletId,
        year: filters.year,
      }),
    [store, filters.outletId, filters.year],
  );
  const trendMonths = useMemo(
    () =>
      months.map((month) => {
        const savedMonth = monthly.find((item) => item.month === month.value);
        return {
          month: month.value,
          netSales: 0,
          totalPurchase: 0,
          cogsMargin: 0,
          profitMargin: 0,
          ...savedMonth,
          label: month.label.toUpperCase(),
          displayLabel: `${month.label} ${filters.year}`,
        };
      }),
    [filters.year, monthly],
  );
  const salesPurchaseTrendData = useMemo(
    () =>
      trendMonths.map((item) => ({
        month: item.label,
        netSales: Number(item.netSales || 0),
        totalPurchase: Number(item.totalPurchase || 0),
      })),
    [trendMonths],
  );
  const current = monthly.find((item) => item.month === filters.month) ?? {
    month: filters.month,
    netSales: 0,
    totalPurchase: 0,
    cogsMargin: 0,
    profitMargin: 0,
  };
  const currentMonthIndex = Math.max(0, filters.month - 1);
  const previousTrendMonth = trendMonths[currentMonthIndex - 1];
  const peakSalesMonth = trendMonths.reduce(
    (best, item) => (Number(item.netSales || 0) > Number(best.netSales || 0) ? item : best),
    trendMonths[0] ?? { netSales: 0, label: "JAN", displayLabel: `Jan ${filters.year}` },
  );
  const salesTrendInsight = peakSalesMonth.netSales
    ? `Net sales peaked in ${peakSalesMonth.displayLabel} at ${toCurrency(peakSalesMonth.netSales)}.`
    : "Not enough saved monthly records yet to identify a sales peak.";
  const cogsDelta = previousTrendMonth ? Number(current.cogsMargin || 0) - Number(previousTrendMonth.cogsMargin || 0) : null;
  const cogsTrendInsight =
    cogsDelta === null
      ? "COGS movement will appear after at least two saved months."
      : Math.abs(cogsDelta) < 0.1
        ? "COGS ratio stayed stable compared with the previous month."
        : cogsDelta < 0
          ? `COGS ratio improved by ${toPercent(Math.abs(cogsDelta))} compared with the previous month.`
          : `COGS ratio increased by ${toPercent(cogsDelta)} compared with the previous month.`;
  const cogsPeak = Math.max(...trendMonths.map((item) => Number(item.cogsMargin || 0)), 0);
  const cogsChartColor = cogsPeak > 40 ? "#ef4444" : cogsPeak > 35 ? "#f59e0b" : "#22c55e";
  const previous = getPreviousPeriod(filters.month, filters.year);
  const alerts = buildAlerts({
    outletId: filters.outletId,
    month: filters.month,
    year: filters.year,
    salesRecords: store.salesRecords,
    salesChannels: store.salesChannels,
    purchaseRecords: store.purchaseRecords,
    suppliers: store.suppliers,
    outletTaxConfigs: store.outletTaxConfigs,
    specialMonths: store.specialMonths,
  });
  const priorityAlerts = alerts.filter((alert) => ["critical", "high"].includes(alert.priority));
  const supplierTotals = store.suppliers
    .map((supplier) => ({
      ...supplier,
      categoryName: getCategoryName(store.purchaseCategories, supplier.default_category_id),
      total: sumAmount(
        store.purchaseRecords.filter(
          (record) =>
            record.outlet_id === filters.outletId &&
              record.month === filters.month &&
            record.year === filters.year &&
            record.supplier_id === supplier.id,
        ),
      ),
      previousTotal: getSupplierPurchaseAmount(store.purchaseRecords, filters.outletId, supplier.id, previous.month, previous.year),
    }))
    .filter((supplier) => supplier.total > 0)
    .map((supplier) => {
      const share = current.totalPurchase ? (supplier.total / current.totalPurchase) * 100 : 0;
      const variance = percentageChange(supplier.total, supplier.previousTotal);
      const status =
        share > 30
          ? { label: "High Dependency", tone: "danger" }
          : variance > 20
            ? { label: "Watch", tone: "warning" }
            : share < 5
              ? { label: "Low Activity", tone: "neutral" }
              : { label: "Normal", tone: "success" };
      return { ...supplier, share, variance, status };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const topSupplierAmount = supplierTotals[0]?.total || 1;

  function openSupplierComparison(supplier) {
    const supplierQuery = encodeURIComponent(supplier.name);
    window.location.hash = `#purchase-comparison?supplier=${supplierQuery}`;
  }

  function alertSuggestions(alert) {
    if (alert.alert_type?.includes("cogs")) return ["Review supplier invoices", "Check wastage patterns", "Audit stock movement"];
    if (alert.alert_type?.includes("sales_down_purchase_up")) return ["Compare receiving records", "Review stock-up timing", "Check sales channel movement"];
    if (alert.related_supplier_id) return ["Validate quantity and unit price", "Check invoice timing", "Compare with category trend"];
    return [alert.suggested_action || "Review source records before month lock"];
  }

  function severityDotClass(alert) {
    if (["critical", "high"].includes(alert.priority) || alert.severity === "danger") return "bg-rose-500";
    if (alert.severity === "warning") return "bg-amber-500";
    if (alert.severity === "success") return "bg-emerald-500";
    return "bg-blue-500";
  }

  return (
    <div className="space-y-5">
      <PageHeader
        section="Overview"
        title="S&P Dashboard"
        description="Saved sales, purchase, COGS, margin and alerts overview."
      />
      <PeriodFilterBar
        store={store}
        filters={filters}
        compact
      />

      {isLoading ? (
        <MetricSkeletons />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Total Net Sales" value={toCurrency(current.netSales)} helper="vs Apr 2026" trend="+12.41%" status="Healthy" />
          <MetricCard label="Total Purchase" value={toCurrency(current.totalPurchase)} helper="vs Apr 2026" trend="+8.25%" status="Normal" />
          <MetricCard
            label="COGS Margin"
            value={toPercent(current.cogsMargin)}
            helper="Purchase / Net Sales"
            trend={current.cogsMargin > 40 ? "High risk" : "Normal"}
            tone={current.cogsMargin > 40 ? "danger" : "success"}
            status={current.cogsMargin > 40 ? "Review" : "In range"}
          />
          <MetricCard label="Profit Margin Est." value={toPercent(current.profitMargin)} helper="Before overheads" trend="+1.32%" status="Estimate" />
          <MetricCard label="Alerts" value={priorityAlerts.length} helper="High / critical only" trend={priorityAlerts.length ? "Review" : "Clear"} tone={priorityAlerts.length ? "warning" : "success"} status={priorityAlerts.length ? "Open" : "Clear"} />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        {isLoading ? (
          <>
            <ChartSkeleton title="Sales vs Purchase Trend" description="Full-year monthly movement" />
            <ChartSkeleton title="COGS Margin Trend" description="Food cost ratio by month" />
          </>
        ) : (
          <>
            <Card title="Sales vs Purchase Trend" description="Full-year monthly movement">
              <div className="px-4 pb-4 pt-3">
                <TrendChart
                  type="area"
                  yAxisType="currency"
                  highlightIndex={currentMonthIndex}
                  labels={salesPurchaseTrendData.map((item) => item.month)}
                  series={[
                    {
                      name: "Net Sales",
                      data: salesPurchaseTrendData.map((item) => item.netSales),
                      stroke: "#16a34a",
                      fill: "#22c55e",
                      area: true,
                      areaOpacity: 0.24,
                      format: toCurrency,
                    },
                    {
                      name: "Total Purchase",
                      data: salesPurchaseTrendData.map((item) => item.totalPurchase),
                      stroke: "#0ea5e9",
                      fill: "#0ea5e9",
                      area: false,
                      strokeWidth: 2.6,
                      format: toCurrency,
                    },
                  ]}
                />
                <div className="mt-3 rounded-xl border border-border bg-primary/5 px-3 py-2 text-xs font-medium text-text-secondary">
                  {salesTrendInsight}
                </div>
              </div>
            </Card>
            <Card title="COGS Margin Trend" description="Food cost ratio by month">
              <div className="px-4 pb-4 pt-3">
                <TrendChart
                  type="area"
                  labels={trendMonths.map((item) => item.label)}
                  yLabel="COGS %"
                  yAxisType="percent"
                  highlightIndex={currentMonthIndex}
                  series={[
                    {
                      name: "COGS Margin",
                      data: trendMonths.map((item) => item.cogsMargin),
                      stroke: cogsChartColor,
                      fill: cogsChartColor,
                      area: true,
                      areaOpacity: 0.18,
                      strokeWidth: 3,
                      format: (value) => toPercent(value),
                    },
                  ]}
                />
                <div className="mt-3 rounded-xl border border-border bg-primary/5 px-3 py-2 text-xs font-medium text-text-secondary">
                  {cogsTrendInsight}
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="Top Suppliers by Purchase" description="Current selected month">
          <div className="divide-y divide-border">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {[1, 2, 3, 4].map((item) => (
                  <SkeletonBlock key={item} className="h-14" />
                ))}
              </div>
            ) : supplierTotals.map((supplier, index) => {
              return (
              <button
                key={supplier.id}
                className="grid w-full cursor-pointer gap-3 px-4 py-3 text-left text-sm transition hover:bg-primary/5 md:grid-cols-[minmax(0,1fr)_180px_128px] md:items-center"
                title={`${months[filters.month - 1]?.label} Purchase: ${toCurrency(supplier.total)}
Previous Month: ${toCurrency(supplier.previousTotal)}
Variance: ${toPercent(supplier.variance)}
Share of Purchase: ${toPercent(supplier.share)}`}
                type="button"
                onClick={() => openSupplierComparison(supplier)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-text-secondary">
                    {index + 1}
                  </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{supplier.name}</div>
                      <div className="text-[13px] font-medium text-text-secondary">{supplier.categoryName}</div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(supplier.total / topSupplierAmount) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-bold">{toCurrency(supplier.total)}</span>
                  <span className="ml-1.5 text-xs font-semibold text-text-secondary">• {toPercent(supplier.share)}</span>
                  <div className={`mt-1 text-xs font-bold ${supplier.variance >= 0 ? "text-emerald-600" : "text-rose-500"}`}>{supplier.variance ? `${supplier.variance >= 0 ? "+" : ""}${toPercent(supplier.variance)}` : "No previous data"}</div>
                </div>
                <div className="flex justify-end">
                  <Badge tone={supplier.status.tone}>{supplier.status.label}</Badge>
                </div>
              </button>
            )})}
          </div>
        </Card>
        <Card title="Recent Alerts" description="Rule-based first-stage insights">
          <div className="space-y-2.5 p-4">
            {isLoading ? (
              [1, 2, 3].map((item) => <SkeletonBlock key={item} className="h-28" />)
            ) : priorityAlerts.slice(0, 4).map((alert) => (
              <button
                key={alert.id}
                className="block w-full cursor-pointer rounded-2xl border border-border bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card"
                type="button"
                onClick={() => setSelectedAlert(alert)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${severityDotClass(alert)}`} />
                      <Badge tone={alert.severity}>{alert.priority}</Badge>
                    </div>
                    <div className="mt-2 font-semibold text-text-primary">{alert.title}</div>
                  </div>
                  <span className="text-xs font-bold text-text-secondary">{alert.confidence_score}%</span>
                </div>
                <div className="mt-2 text-sm font-bold text-text-primary">
                  {formatAlertValue(alert, alert.current_value)} vs {formatAlertValue(alert, alert.comparison_value)}
                </div>
                <p className="mt-1 text-sm leading-5 text-text-secondary">{alert.description}</p>
                {alert.related_supplier_id ? (
                  <p className="mt-2 text-xs font-semibold text-text-muted">
                    {getSupplierName(store.suppliers, alert.related_supplier_id)}
                  </p>
                ) : null}
                <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-text-secondary">Triggered from {months[alert.month - 1]?.label} {alert.year} data</span>
                    <span className="font-bold text-text-secondary">{alert.confidence_score}% confidence</span>
                  </div>
                  <div className="mt-1 font-bold text-primary">View details</div>
                </div>
              </button>
            ))}
            {!isLoading && !priorityAlerts.length ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                <div className="font-bold text-emerald-800">No abnormal activity detected.</div>
                <p className="mt-1 text-emerald-700">Operations look healthy this month.</p>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {selectedAlert ? (
        <Modal
          title={selectedAlert.title}
          description={`Triggered from ${months[selectedAlert.month - 1]?.label} ${selectedAlert.year} data`}
          onClose={() => setSelectedAlert(null)}
          footer={<button className="btn-primary" type="button" onClick={() => setSelectedAlert(null)}>Done</button>}
        >
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-semibold text-text-secondary">Current value</div>
                <div className="mt-2 text-xl font-bold text-text-primary">{formatAlertValue(selectedAlert, selectedAlert.current_value)}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-semibold text-text-secondary">Comparison value</div>
                <div className="mt-2 text-xl font-bold text-text-primary">{formatAlertValue(selectedAlert, selectedAlert.comparison_value)}</div>
              </div>
            </div>
            <div className="rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${severityDotClass(selectedAlert)}`} />
                <Badge tone={selectedAlert.severity}>{selectedAlert.priority}</Badge>
                <span className="text-xs font-bold text-text-secondary">{selectedAlert.confidence_score}% confidence</span>
              </div>
              <p className="mt-3 text-text-secondary">{selectedAlert.description}</p>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4">
              <div className="font-bold text-blue-900">Recommended</div>
              <ul className="mt-2 space-y-1 text-blue-800">
                {alertSuggestions(selectedAlert).map((action) => (
                  <li key={action}>• {action}</li>
                ))}
              </ul>
            </div>
            <button
              className="btn-secondary w-full"
              type="button"
              onClick={() => {
                window.location.hash = selectedAlert.related_supplier_id
                  ? `#purchase-comparison?supplier=${encodeURIComponent(getSupplierName(store.suppliers, selectedAlert.related_supplier_id))}`
                  : "#purchase-comparison";
              }}
            >
              Open Purchase Comparison
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
