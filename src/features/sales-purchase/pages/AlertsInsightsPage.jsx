import { useMemo, useState } from "react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { buildAlerts, getSupplierName, monthLabel, toCurrency, toPercent } from "../utils/analytics.js";

const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 };
const statusRank = { active: 4, reviewed: 3, resolved: 2, dismissed: 1 };

function formatAlertValue(alert, value) {
  if (["cogs_margin_critical", "cogs_margin_high", "cogs_margin_watch", "sst_unusual", "delivery_platform_dependency_high"].includes(alert.alert_type)) {
    return toPercent(Number(value));
  }
  return toCurrency(value);
}

function normalizeStatus(status) {
  return status === "open" ? "active" : status ?? "active";
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
  if (alert.status === "reviewed") return "border-amber-200 bg-amber-50/35";
  if (alert.status === "resolved") return "border-emerald-200 bg-emerald-50/40 opacity-80";
  if (alert.status === "dismissed") return "border-slate-200 bg-slate-50/70 opacity-75";
  if (tone === "danger") return "border-rose-200 bg-rose-50/55";
  if (tone === "warning") return "border-amber-200 bg-amber-50/55";
  if (tone === "success") return "border-emerald-200 bg-emerald-50/45";
  return "border-blue-200 bg-blue-50/35";
}

function statusBadge(alert) {
  if (alert.status === "reviewed") return { tone: "warning", label: "Reviewed" };
  if (alert.status === "resolved") return { tone: "success", label: "Resolved" };
  if (alert.status === "dismissed") return { tone: "neutral", label: "Dismissed" };
  return { tone: severityTone(alert), label: alert.priority };
}

function relativeTime(timestamp) {
  if (!timestamp) return "";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return hours < 48 ? "yesterday" : `${Math.round(hours / 24)}d ago`;
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

function EmptyState({ statusFilter }) {
  const activeCopy = statusFilter === "active" || statusFilter === "all";
  return (
    <div className={`rounded-2xl border border-dashed p-8 text-center text-sm ${activeCopy ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-slate-50 text-text-secondary"}`}>
      <div className="font-bold text-text-primary">{activeCopy ? "Operations look healthy this month." : "No alerts found for this filter."}</div>
      <p className="mt-1">{activeCopy ? "No active abnormal activity detected." : "Try another status, alert type, priority or period."}</p>
    </div>
  );
}

export default function AlertsInsightsPage({ store, ui }) {
  const filters = usePeriodFilters(store);
  const [severity, setSeverity] = useState("all");
  const [priority, setPriority] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("priority");
  const [alertMeta, setAlertMeta] = useState({});
  const [selected, setSelected] = useState(null);

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
    return generated.map((alert) => {
      const meta = alertMeta[alert.id] ?? {};
      return {
        ...alert,
        ...meta,
        status: normalizeStatus(meta.status ?? alert.status),
        possible_causes: meta.possible_causes ?? possibleCauses(alert),
        related_records: meta.related_records ?? relatedRecords(alert, store),
      };
    });
  }, [alertMeta, filters.month, filters.outletId, filters.year, store]);

  const counters = useMemo(() => ({
    critical: allAlerts.filter((alert) => alert.priority === "critical").length,
    high: allAlerts.filter((alert) => alert.priority === "high").length,
    medium: allAlerts.filter((alert) => alert.priority === "medium").length,
    low: allAlerts.filter((alert) => alert.priority === "low").length,
    unreviewed: allAlerts.filter((alert) => alert.status === "active").length,
  }), [allAlerts]);

  const alerts = useMemo(() => {
    const filtered = allAlerts
      .filter((alert) => severity === "all" || alert.severity === severity)
      .filter((alert) => priority === "all" || alert.priority === priority)
      .filter((alert) => statusFilter === "all" || alert.status === statusFilter)
      .filter((alert) => typeFilter === "all" || alertTypeGroup(alert.alert_type) === typeFilter);

    return filtered.sort((a, b) => {
      if (sortBy === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === "confidence") return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
      if (sortBy === "unreviewed") return (statusRank[b.status] ?? 0) - (statusRank[a.status] ?? 0) || (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
      return (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1) || (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0) || (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
    });
  }, [allAlerts, priority, severity, sortBy, statusFilter, typeFilter]);

  function setAlertStatus(alert, status) {
    const timestampKey = status === "reviewed" ? "reviewed_at" : status === "resolved" ? "resolved_at" : "dismissed_at";
    setAlertMeta((current) => ({
      ...current,
      [alert.id]: {
        ...current[alert.id],
        status,
        [timestampKey]: new Date().toISOString(),
        handled_by: "Marcus",
      },
    }));
    ui.notify({ title: `Alert ${status}`, message: alert.title });
  }

  function confidenceTitle() {
    return "Confidence is based on:\n- historical variance\n- month-over-month deviation\n- 3-month average comparison\n- sales vs purchase movement";
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Controls"
        title="Alerts & Insights"
        description="Operational risk inbox for abnormal supplier purchase, COGS and sales movement."
      />

      <PeriodFilterBar
        store={store}
        filters={filters}
        compact
        actions={
          <>
            <select className="control h-10" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="all">All Priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select className="control h-10" value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="all">All Severity</option>
              <option value="danger">Danger</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
            </select>
            <select className="control h-10" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="active">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All Status</option>
            </select>
            <select className="control h-10" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All Alert Types</option>
              <option value="COGS">COGS</option>
              <option value="Supplier">Supplier</option>
              <option value="Sales">Sales</option>
              <option value="SST">SST</option>
              <option value="Purchase">Purchase</option>
            </select>
            <select className="control h-10" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="priority">Priority + Unreviewed</option>
              <option value="newest">Newest</option>
              <option value="confidence">Highest Confidence</option>
              <option value="unreviewed">Unreviewed First</option>
            </select>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {[
          ["critical", "Critical", counters.critical, "danger"],
          ["high", "High", counters.high, "danger"],
          ["medium", "Medium", counters.medium, "warning"],
          ["low", "Low", counters.low, "info"],
          ["active", "Unreviewed", counters.unreviewed, "neutral"],
        ].map(([key, label, count, tone]) => {
          const isActive = key === "active" ? statusFilter === "active" && priority === "all" : priority === key;
          return (
          <button
            key={key}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              isActive
                ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                : "border-border bg-white text-text-secondary hover:border-primary/30 hover:bg-slate-50 hover:text-primary"
            }`}
            type="button"
            onClick={() => {
              if (key === "active") {
                setStatusFilter("active");
                setPriority("all");
                return;
              }
              setPriority(key);
              setStatusFilter("all");
            }}
          >
            <Badge tone={tone}>{count}</Badge>
            <span className="ml-2">{label}</span>
          </button>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {alerts.map((alert) => {
          const badge = statusBadge(alert);
          const timestamp =
            alert.status === "reviewed"
              ? `Reviewed ${relativeTime(alert.reviewed_at)}`
              : alert.status === "resolved"
                ? `Resolved by ${alert.handled_by ?? "Marcus"}`
                : alert.status === "dismissed"
                  ? "Dismissed"
                  : `Triggered from ${monthLabel(alert.month)} ${alert.year} data`;

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
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setSelected(alert)}>Details</button>
                {alert.status === "active" ? (
                  <>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setAlertStatus(alert, "reviewed")}>Mark Reviewed</button>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setAlertStatus(alert, "dismissed")}>Dismiss</button>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setAlertStatus(alert, "resolved")}>Resolve</button>
                  </>
                ) : null}
                {alert.status === "reviewed" ? (
                  <>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setAlertStatus(alert, "resolved")}>Resolve</button>
                    <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setAlertStatus(alert, "dismissed")}>Dismiss</button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {!alerts.length ? <EmptyState statusFilter={statusFilter} /> : null}

      {selected ? (
        <Modal title={selected.title} description="Alert detail and suggested response" onClose={() => setSelected(null)} footer={<button className="btn-primary" type="button" onClick={() => setSelected(null)}>Done</button>}>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={selected.severity}>{selected.priority}</Badge>
              <Badge tone={statusBadge(selected).tone}>{statusBadge(selected).label}</Badge>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-text-secondary" title={confidenceTitle()}>{selected.confidence_score}% confidence</span>
            </div>
            <p className="text-text-secondary">{selected.description}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Current</div><strong>{formatAlertValue(selected, selected.current_value)}</strong></div>
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Comparison</div><strong>{formatAlertValue(selected, selected.comparison_value)}</strong></div>
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Change</div><strong>{toPercent(selected.percentage_change)}</strong></div>
            </div>
            <div>
              <strong>Possible causes</strong>
              <ul className="mt-1 space-y-1 text-text-secondary">
                {selected.possible_causes.map((cause) => <li key={cause}>- {cause}</li>)}
              </ul>
            </div>
            <div>
              <strong>Suggested action</strong>
              <p className="mt-1 text-text-secondary">{selected.suggested_action}</p>
            </div>
            <div>
              <strong>Related records</strong>
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
