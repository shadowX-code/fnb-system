import { useMemo, useState } from "react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { buildAlerts, getSupplierName, monthLabel, toCurrency, toPercent } from "../utils/analytics.js";

export default function AlertsInsightsPage({ store, ui }) {
  const filters = usePeriodFilters(store);
  const [severity, setSeverity] = useState("all");
  const [reviewed, setReviewed] = useState(new Set());
  const [selected, setSelected] = useState(null);
  const alerts = useMemo(() => {
    const all = buildAlerts({
      outletId: filters.outletId,
      month: filters.month,
      year: filters.year,
      salesRecords: store.salesRecords,
      salesChannels: store.salesChannels,
      purchaseRecords: store.purchaseRecords,
      suppliers: store.suppliers,
    });
    all.push({
      id: "best-channel",
      severity: "low",
      title: "Best Performing Channel",
      description: "GrabFood sales increased against the last month.",
      current_value: 6088,
      comparison_value: 5200,
      percentage_change: 17,
      month: filters.month,
      year: filters.year,
      outlet_id: filters.outletId,
      alert_type: "best_channel",
    });
    return all.filter((alert) => severity === "all" || alert.severity === severity);
  }, [filters, severity, store]);
  return (
    <div className="space-y-5">
      <PageHeader
        section="Controls"
        title="Alerts & Insights"
        description="Review rule-based alerts for abnormal supplier purchase, COGS and sales movement."
      />

      <PeriodFilterBar
        store={store}
        filters={filters}
        compact
        actions={
          <select className="control" value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">All Severity</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {alerts.map((alert) => (
          <Card key={alert.id} className={reviewed.has(alert.id) ? "opacity-65" : ""}>
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <Badge tone={alert.severity === "high" ? "danger" : alert.severity === "medium" ? "warning" : "info"}>{alert.severity}</Badge>
                <span className="text-xs font-semibold text-text-muted">{monthLabel(alert.month)} {alert.year}</span>
              </div>
              <h3 className="mt-4 text-sm font-bold">{alert.title}</h3>
              <p className="mt-2 text-sm text-text-secondary">{alert.description}</p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-xs text-text-secondary">
                <div>{toCurrency(alert.current_value)} vs {toCurrency(alert.comparison_value)}</div>
                <div className="mt-1 font-bold text-text-primary">{toPercent(alert.percentage_change)}</div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className="btn-secondary h-9 flex-1" onClick={() => setSelected(alert)}>Details</button>
                <button className="btn-secondary h-9 flex-1" onClick={() => { setReviewed((current) => new Set([...current, alert.id])); ui.notify({ title: "Marked reviewed", message: alert.title }); }}>Reviewed</button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {selected ? (
        <Modal title={selected.title} description="Alert detail and suggested response" onClose={() => setSelected(null)} footer={<button className="btn-primary" onClick={() => setSelected(null)}>Done</button>}>
          <div className="space-y-4 text-sm">
            <p className="text-text-secondary">{selected.description}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Current</div><strong>{toCurrency(selected.current_value)}</strong></div>
              <div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-text-secondary">Comparison</div><strong>{toCurrency(selected.comparison_value)}</strong></div>
            </div>
            <div>
              <strong>Possible causes</strong>
              <p className="mt-1 text-text-secondary">Supplier pricing changed, order quantity increased, month-end correction, or sales mix moved.</p>
            </div>
            <div>
              <strong>Suggested action</strong>
              <p className="mt-1 text-text-secondary">Check invoices, compare purchase quantity, and review supplier category trend before month lock.</p>
            </div>
            {selected.related_supplier_id ? <p className="text-xs font-semibold text-text-muted">Supplier: {getSupplierName(store.suppliers, selected.related_supplier_id)}</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
