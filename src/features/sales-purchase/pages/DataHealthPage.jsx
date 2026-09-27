import { useMemo } from "react";
import { ClipboardList, ShieldCheck, ShoppingCart } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { buildAlerts, getNetSales, getOutletTaxConfig, sumAmount, toCurrency } from "../utils/analytics.js";

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getSalesRecordRows(store, outletId, month, year) {
  return store.salesRecords.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function getSalesChannelKey(record) {
  return record.channel_id || String(record.channel_name ?? "").trim().toLowerCase();
}

function countUniqueSalesChannels(rows) {
  return new Set(rows.map(getSalesChannelKey).filter(Boolean)).size;
}

function getLatestUpdatedRecord(rows) {
  return [...rows].sort((a, b) => new Date(a.updated_at || a.created_at || 0) - new Date(b.updated_at || b.created_at || 0)).at(-1);
}

function getPurchaseRecordRows(store, outletId, month, year) {
  return store.purchaseRecords.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function getStatus({ salesScore, purchaseScore, warnings, hasAnyData }) {
  if (!hasAnyData) return { label: "Draft", tone: "neutral" };
  if (warnings.length) return { label: "Incomplete", tone: "danger" };
  if (salesScore === 100 && purchaseScore === 100) return { label: "Source checks complete", tone: "success" };
  return { label: "Draft", tone: "warning" };
}

export default function DataHealthPage({ store, auth }) {
  const filters = usePeriodFilters(store);
  const salesRows = getSalesRecordRows(store, filters.outletId, filters.month, filters.year);
  const purchaseRows = getPurchaseRecordRows(store, filters.outletId, filters.month, filters.year);
  const opexRow = (store.operatingExpenses ?? []).find((record) => record.outlet_id === filters.outletId && Number(record.month) === Number(filters.month) && Number(record.year) === Number(filters.year));
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year, store.salesChannels);
  const totalPurchase = sumAmount(purchaseRows);
  const hasAnyData = salesRows.length > 0 || purchaseRows.length > 0;
  const sstConfig = getOutletTaxConfig(store.outletTaxConfigs, filters.outletId, filters.month, filters.year, "SST");
  const sstEnabled = Boolean(sstConfig.enabled);

  const alerts = useMemo(() => buildAlerts({
    outletId: filters.outletId,
    month: filters.month,
    year: filters.year,
    salesRecords: store.salesRecords,
    salesChannels: store.salesChannels,
    purchaseRecords: store.purchaseRecords,
    suppliers: store.suppliers,
    outletTaxConfigs: store.outletTaxConfigs,
    specialMonths: store.specialMonths,
  }), [filters.month, filters.outletId, filters.year, store]);

  const highRiskOperationalAlerts = alerts.filter((alert) => ["critical", "high"].includes(alert.priority));
  const uniqueSalesChannelCount = countUniqueSalesChannels(salesRows);
  const latestSalesRecord = getLatestUpdatedRecord(salesRows);
  const sstRecord = salesRows.find((record) => {
    const name = store.salesChannels.find((channel) => channel.id === record.channel_id)?.name;
    return ["SST Deduction", "SST", "SST (-)"].includes(name);
  });
  const hasSst = Boolean(sstRecord && Number(sstRecord.amount || 0) > 0);
  const purchaseEmptyRows = purchaseRows.filter((record) => !record.supplier_id || !record.category_id || record.amount === "" || record.amount === null || record.amount === undefined);

  const warnings = [
    !hasAnyData ? "No records entered for this month." : null,
    !salesRows.length ? "No saved sales data found for this month." : null,
    !purchaseRows.length ? "No saved purchase data found for this month." : null,
    !opexRow ? "Operating expense evidence missing; EBITDA remains unavailable." : null,
    sstEnabled && !hasSst && salesRows.length ? "SST deduction missing." : null,
    purchaseRows.length && !salesRows.length ? "Purchase exists but sales data is missing." : null,
    purchaseRows.length && salesRows.length && netSales <= 0 ? "Net sales is zero while purchases exist. Please review." : null,
    purchaseEmptyRows.length ? `${purchaseEmptyRows.length} supplier rows incomplete.` : null,
  ].filter(Boolean);

  const salesScore = !salesRows.length
    ? 0
    : Math.max(0, Math.round(100 - (purchaseRows.length && netSales <= 0 ? 25 : 0) - (sstEnabled && !hasSst ? 10 : 0)));
  const purchaseScore = !purchaseRows.length
    ? 0
    : Math.max(0, Math.round(100 - purchaseEmptyRows.length * 15));
  const overallScore = Math.round(salesScore * 0.45 + purchaseScore * 0.45 + (warnings.length ? 0 : 10));
  const monthStatus = getStatus({ salesScore, purchaseScore, warnings, hasAnyData });

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Data Health"
        description="Review loaded source completeness and exceptions. This review does not close or protect a financial month."
      />

      <PeriodFilterBar store={store} filters={filters} auth={auth} compact />

      {!hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-6 text-sm text-text-secondary">
          <div className="font-bold text-text-primary">No records entered for this month.</div>
          <p className="mt-1">Enter Sales and Supplier Purchase evidence to complete source checks.</p>
        </div>
      ) : null}

      <div>

        <Card title="Loaded Source Checks" description="Review indicators for loaded records; not financial approval.">
          <div className="space-y-4 p-4">
            {[
              ["Sales", salesScore],
              ["Purchase", purchaseScore],
              ["Overall", overallScore],
            ].map(([label, score]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm font-semibold"><span>{label}</span><span>{score}%</span></div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${score >= 100 ? "bg-emerald-500" : score >= 80 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${score}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-secondary">Month Status</span>
                <Badge tone={monthStatus.tone}>{monthStatus.label}</Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={ClipboardList} label="Sales Records" value={`${uniqueSalesChannelCount} channels`} helper={salesRows.length ? `Last updated ${formatTime(latestSalesRecord?.updated_at)}` : "Missing"} tone={salesScore === 100 ? "success" : "warning"} />
        <MetricCard icon={ShoppingCart} label="Purchase Records" value={`${purchaseRows.length} suppliers`} helper={purchaseEmptyRows.length ? `${purchaseEmptyRows.length} incomplete rows` : "Required fields complete"} tone={purchaseScore === 100 ? "success" : "warning"} />
        <MetricCard icon={ShieldCheck} label="Month Status" value={monthStatus.label} helper={`${salesRows.length ? toCurrency(netSales) : "Missing"} sales · ${purchaseRows.length ? toCurrency(totalPurchase) : "Missing"} purchase`} tone={monthStatus.tone === "danger" ? "danger" : monthStatus.tone === "success" ? "success" : "warning"} />
      </div>

      {warnings.length ? (
        <Card title="Warnings Detected" description="Review missing or incomplete source evidence.">
          <div className="grid gap-2 p-4 md:grid-cols-2">
            {warnings.map((warning) => (
              <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{warning}</div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck size={16} /> Source checks complete.</div>
          <p className="mt-1">This is a data review, not accounting approval or a protected-month state.</p>
        </div>
      )}

      {!opexRow && hasAnyData ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/35 p-4 text-sm text-blue-800">
          <div className="font-bold text-text-primary">OpEx not entered</div>
          <p className="mt-1">Operating expense has not been saved. EBITDA remains unavailable; missing expense is not RM0.</p>
        </div>
      ) : null}

      {highRiskOperationalAlerts.length ? (
        <Card title="Operational Alerts Detected" description="Advisory risk signals, not financial approval.">
          <div className="grid gap-2 p-4 md:grid-cols-2">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              {highRiskOperationalAlerts.length} high-risk operational alerts detected.
            </div>
            {highRiskOperationalAlerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="rounded-xl border border-border bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">{alert.title}</span>
                  <Badge tone={alert.priority === "critical" ? "danger" : "warning"}>{alert.priority}</Badge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{alert.description}</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

    </div>
  );
}
