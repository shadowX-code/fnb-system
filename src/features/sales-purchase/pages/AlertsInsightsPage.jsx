import { useMemo, useState } from "react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { buildAlerts, getSupplierName, monthLabel, toCurrency, toPercent } from "../utils/analytics.js";

const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 };

function formatAlertValue(alert, value) {
  if (["cogs_margin_critical", "cogs_margin_high", "cogs_margin_watch", "sst_unusual", "delivery_platform_dependency_high"].includes(alert.alert_type)) {
    return toPercent(Number(value));
  }
  return toCurrency(value);
}

function alertTypeGroup(alertType = "") {
  if (alertType.includes("cogs")) return "COGS";
  if (alertType.includes("supplier")) return "Supplier";
  if (alertType.includes("sales") || alertType.includes("dine")) return "Sales";
  if (alertType.includes("sst")) return "SST";
  if (alertType.includes("purchase")) return "Purchase";
  return "Other";
}

function severityTone(alert) {
  if (alert.priority === "critical" || alert.priority === "high" || alert.severity === "danger") return "danger";
  if (alert.priority === "medium" || alert.severity === "warning") return "warning";
  if (alert.severity === "success") return "success";
  return "info";
}

function cardTone(alert) {
  const tone = severityTone(alert);
  if (tone === "danger") return "border-rose-200 bg-rose-50/55";
  if (tone === "warning") return "border-amber-200 bg-amber-50/55";
  if (tone === "success") return "border-emerald-200 bg-emerald-50/45";
  return "border-blue-200 bg-blue-50/35";
}

function statusBadge(alert) {
  return { tone: severityTone(alert), label: alert.priority };
}

function possibleCauses(alert) {
  if (alert.alert_type?.includes("cogs")) return ["Supplier price increase", "Higher wastage", "Stock receiving timing", "Sales mix changed"];
  if (alert.alert_type?.includes("supplier")) return ["Unit price changed", "Bulk purchase", "Invoice timing", "Category-wide cost movement"];
  if (alert.alert_type?.includes("sales")) return ["Traffic change", "Promotion timing", "Operating hours", "Delivery channel mix"];
  if (alert.alert_type?.includes("sst")) return ["SST entry variance", "Refunds or voids", "Manual adjustment timing"];
  return ["Month-end correction", "Data entry timing", "Operational exception"];
}

function relatedRecords(alert, store) {
  const records = [
    `Outlet: ${store.outlets.find((outlet) => outlet.id === alert.outlet_id)?.name ?? alert.outlet_id}`,
    `Period: ${monthLabel(alert.month)} ${alert.year}`,
    `Alert type: ${alertTypeGroup(alert.alert_type)}`,
  ];
  if (alert.related_supplier_id) records.push(`Supplier: ${getSupplierName(store.suppliers, alert.related_supplier_id)}`);
  return records;
}

function investigationChecklist(alert) {
  if (alert.alert_type?.includes("cogs")) return ["Compare supplier invoices against receiving records", "Check wastage and stock movement", "Review high-value purchase categories"];
  if (alert.alert_type?.includes("supplier")) return ["Check invoice quantity and unit price", "Confirm whether this was a bulk purchase", "Compare against supplier purchase history"];
  if (alert.alert_type?.includes("sales")) return ["Check outlet traffic and operating hours", "Review channel mix movement", "Compare against promotions or special events"];
  if (alert.alert_type?.includes("sst")) return ["Compare SST entry with expected tax amount", "Review refunds, voids, or adjustments", "Confirm outlet tax configuration"];
  return ["Review source records", "Check month-end adjustments", "Confirm whether this was intentional"];
}

function hasPeriodData(store, filters) {
  const salesCount = store.salesRecords.filter((record) => record.outlet_id === filters.outletId && record.month === filters.month && record.year === filters.year).length;
  const purchaseCount = store.purchaseRecords.filter((record) => record.outlet_id === filters.outletId && record.month === filters.month && record.year === filters.year).length;
  return salesCount > 0 || purchaseCount > 0;
}

function EmptyState({ hasData }) {
  return (
    <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${hasData ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-slate-50 text-text-secondary"}`}>
      <div className="font-bold text-text-primary">{hasData ? "No risk alerts for this period." : "Not enough data to generate insights yet."}</div>
      <p className="mt-1">{hasData ? "Operations look healthy." : "Save sales and purchase records for this outlet and month to generate risk insights."}</p>
    </div>
  );
}

export default function AlertsInsightsPage({ store, ui, auth }) {
  const filters = usePeriodFilters(store);
  const [severity, setSeverity] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const hasData = useMemo(() => hasPeriodData(store, filters), [filters, store]);

  const allAlerts = useMemo(() => {
    const generated = buildAlerts({
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
    return generated.map((alert) => ({
      ...alert,
      possible_causes: possibleCauses(alert),
      related_records: relatedRecords(alert, store),
      investigation_checklist: investigationChecklist(alert),
    }));
  }, [filters.month, filters.outletId, filters.year, store]);

  const counters = useMemo(() => ({
    critical: allAlerts.filter((alert) => alert.priority === "critical").length,
    high: allAlerts.filter((alert) => alert.priority === "high").length,
    medium: allAlerts.filter((alert) => alert.priority === "medium").length,
    low: allAlerts.filter((alert) => alert.priority === "low").length,
  }), [allAlerts]);

  const alerts = useMemo(() => {
    const filtered = allAlerts
      .filter((alert) => severity === "all" || alert.severity === severity)
      .filter((alert) => typeFilter === "all" || alertTypeGroup(alert.alert_type) === typeFilter);

    return filtered.sort((a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0) || (b.confidence_score ?? 0) - (a.confidence_score ?? 0));
  }, [allAlerts, severity, typeFilter]);

  function confidenceTitle() {
    return "Confidence is based on:\n- historical variance\n- month-over-month deviation\n- 3-month average comparison\n- sales vs purchase movement";
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Alerts & Insights"
        description="Operational risk inbox for abnormal supplier purchase, COGS and sales movement."
      />

      <PeriodFilterBar
        store={store}
        filters={filters}
        auth={auth}
        compact
        actions={
          <>
            <SelectField className="w-40" value={severity === "all" ? "" : severity} placeholder="All Severity" options={["danger", "warning", "info", "success"].map((item) => ({ value: item, label: item[0].toUpperCase() + item.slice(1) }))} onChange={(nextValue) => setSeverity(nextValue || "all")} />
            <SelectField className="w-44" value={typeFilter === "all" ? "" : typeFilter} placeholder="All Alert Types" options={["COGS", "Supplier", "Sales", "SST", "Purchase"].map((item) => ({ value: item, label: item }))} onChange={(nextValue) => setTypeFilter(nextValue || "all")} />
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {[
          ["critical", "Critical", counters.critical, "danger"],
          ["high", "High", counters.high, "danger"],
          ["medium", "Medium", counters.medium, "warning"],
          ["low", "Low", counters.low, "info"],
        ].map(([key, label, count, tone]) => (
          <button
            key={key}
            className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-bold text-text-secondary transition hover:border-primary/30 hover:bg-slate-50 hover:text-primary"
            type="button"
            onClick={() => {
              setSeverity(key === "critical" || key === "high" ? "danger" : key === "medium" ? "warning" : "info");
            }}
          >
            <Badge tone={tone}>{count}</Badge>
            <span className="ml-2">{label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {alerts.map((alert) => {
          const badge = statusBadge(alert);
          const timestamp = `Detected from ${monthLabel(alert.month)} ${alert.year} data`;

          return (
            <article key={alert.id} className={`rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-card ${cardTone(alert)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-text-secondary" title={confidenceTitle()}>
                    {alert.confidence_score}% confidence
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-text-muted">{timestamp}</span>
              </div>
              <h3 className="mt-2 text-sm font-bold leading-5 text-text-primary">{alert.title}</h3>
              <div className="mt-1 text-[13px] font-bold text-text-primary">
                {formatAlertValue(alert, alert.current_value)} vs {formatAlertValue(alert, alert.comparison_value)}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-4 text-text-secondary">{alert.description}</p>
              <div className="mt-2 rounded-xl bg-white/60 px-3 py-2 text-xs text-text-secondary">
                <span className="font-bold text-text-primary">Suggested: </span>
                {alert.suggested_action}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setSelected(alert)}>View Details</button>
              </div>
            </article>
          );
        })}
      </div>

      {!alerts.length ? <EmptyState hasData={hasData} /> : null}

      {selected ? (
        <Modal title={selected.title} description="Why this risk alert was generated" onClose={() => setSelected(null)} footer={<button className="btn-primary" type="button" onClick={() => setSelected(null)}>Done</button>}>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={selected.severity}>{selected.priority}</Badge>
              <Badge tone="info">{alertTypeGroup(selected.alert_type)}</Badge>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-text-secondary" title={confidenceTitle()}>{selected.confidence_score}% confidence</span>
            </div>
            <p className="text-text-secondary">{selected.description}</p>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-text-muted">Rule Used</div>
              <p className="mt-1 font-semibold text-text-primary">{selected.alert_type?.replace(/_/g, " ") || "Business rule threshold"}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Current Value</div><strong>{formatAlertValue(selected, selected.current_value)}</strong></div>
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Comparison Baseline</div><strong>{formatAlertValue(selected, selected.comparison_value)}</strong></div>
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Change</div><strong>{toPercent(selected.percentage_change)}</strong></div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-border p-4">
                <div className="text-xs font-bold uppercase text-text-muted">Sales Value</div>
                <strong>{selected.alert_type?.includes("sales") ? formatAlertValue(selected, selected.current_value) : selected.current_value != null ? formatAlertValue(selected, selected.current_value) : "—"}</strong>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <div className="text-xs font-bold uppercase text-text-muted">Purchase Value</div>
                <strong>{selected.alert_type?.includes("purchase") || selected.alert_type?.includes("cogs") || selected.alert_type?.includes("supplier") ? formatAlertValue(selected, selected.current_value) : selected.comparison_value != null ? formatAlertValue(selected, selected.comparison_value) : "—"}</strong>
              </div>
            </div>
            <div>
              <strong>Why it may have triggered</strong>
              <ul className="mt-1 space-y-1 text-text-secondary">
                {selected.possible_causes.map((cause) => <li key={cause}>- {cause}</li>)}
              </ul>
            </div>
            <div>
              <strong>Suggested check</strong>
              <p className="mt-1 text-text-secondary">{selected.suggested_action}</p>
            </div>
            <div>
              <strong>Investigation checklist</strong>
              <ul className="mt-1 space-y-1 text-text-secondary">
                {selected.investigation_checklist.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </div>
            <div>
              <strong>Detected period / source</strong>
              <ul className="mt-1 space-y-1 text-text-secondary">
                {selected.related_records.map((record) => <li key={record}>- {record}</li>)}
              </ul>
            </div>
            {selected.related_supplier_id ? <p className="text-xs font-semibold text-text-muted">Supplier: {getSupplierName(store.suppliers, selected.related_supplier_id)}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
