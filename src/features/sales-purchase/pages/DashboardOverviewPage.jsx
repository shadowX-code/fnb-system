import { useMemo } from "react";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { months } from "../data/mockData.js";
import {
  buildAlerts,
  buildMonthlySummary,
  getSupplierName,
  sumAmount,
  toCurrency,
  toPercent,
} from "../utils/analytics.js";

export default function DashboardOverviewPage({ store }) {
  const filters = usePeriodFilters(store);
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
  const current = monthly.find((item) => item.month === filters.month) ?? monthly[0];
  const alerts = buildAlerts({
    outletId: filters.outletId,
    month: filters.month,
    year: filters.year,
    salesRecords: store.salesRecords,
    salesChannels: store.salesChannels,
    purchaseRecords: store.purchaseRecords,
    suppliers: store.suppliers,
  });
  const supplierTotals = store.suppliers
    .map((supplier) => ({
      ...supplier,
      total: sumAmount(
        store.purchaseRecords.filter(
          (record) =>
            record.outlet_id === filters.outletId &&
            record.month === filters.month &&
            record.year === filters.year &&
            record.supplier_id === supplier.id,
        ),
      ),
    }))
    .filter((supplier) => supplier.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <PeriodFilterBar
        store={store}
        filters={filters}
        compact
        actions={
          <>
            <button className="btn-secondary" type="button">Reset</button>
            <button className="btn-primary" type="button">Apply</button>
          </>
        }
      />

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
        <MetricCard label="Alerts" value={alerts.length} helper="High risk items" trend={alerts.length ? "Review" : "Clear"} tone={alerts.length ? "warning" : "success"} status={alerts.length ? "Open" : "Clear"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card title="Sales vs Purchase Trend" description="Last six saved months">
          <div className="p-5">
            <TrendChart
              type="bar"
              labels={monthly.slice(0, 6).map((item) => months[item.month - 1].label)}
              series={[
                {
                  name: "Net Sales",
                  data: monthly.slice(0, 6).map((item) => item.netSales),
                  color: "bg-primary",
                  format: toCurrency,
                },
                {
                  name: "Total Purchase",
                  data: monthly.slice(0, 6).map((item) => item.totalPurchase),
                  color: "bg-emerald-500",
                  format: toCurrency,
                },
              ]}
            />
          </div>
        </Card>
        <Card title="COGS Margin Trend" description="Food cost ratio by month">
          <div className="p-5">
            <TrendChart
              labels={monthly.slice(0, 6).map((item) => months[item.month - 1].label)}
              yLabel="COGS %"
              series={[
                {
                  name: "COGS Margin",
                  data: monthly.slice(0, 6).map((item) => item.cogsMargin),
                  color: "bg-orange-500",
                  stroke: "#f97316",
                  format: (value) => toPercent(value),
                },
              ]}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card title="Top Suppliers by Purchase" description="Current selected month">
          <div className="divide-y divide-border">
            {supplierTotals.map((supplier, index) => {
              const max = supplierTotals[0]?.total || 1;
              return (
              <div key={supplier.id} className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1fr_130px_96px] md:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-text-secondary">
                    {index + 1}
                  </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{supplier.name}</div>
                      <div className="text-xs text-text-secondary">Category linked supplier</div>
                    </div>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(supplier.total / max) * 100}%` }} />
                  </div>
                </div>
                <span className="font-bold">{toCurrency(supplier.total)}</span>
                <Badge tone={index < 2 ? "warning" : "success"}>{index < 2 ? "+18%" : "Normal"}</Badge>
              </div>
            )})}
          </div>
        </Card>
        <Card title="Recent Alerts" description="Rule-based first-stage insights">
          <div className="space-y-3 p-5">
            {alerts.slice(0, 4).map((alert) => (
              <div key={alert.id} className="rounded-2xl border border-border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-text-primary">{alert.title}</div>
                  <Badge tone={alert.severity === "high" ? "danger" : "warning"}>{alert.severity}</Badge>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{alert.description}</p>
                {alert.related_supplier_id ? (
                  <p className="mt-2 text-xs font-semibold text-text-muted">
                    {getSupplierName(store.suppliers, alert.related_supplier_id)}
                  </p>
                ) : null}
                <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span>{toCurrency(alert.current_value)} vs {toCurrency(alert.comparison_value)}</span>
                  <button className="font-bold text-primary" type="button">View details</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
