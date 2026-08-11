import { AlertTriangle, Clock3, Factory, PackageCheck } from "lucide-react";
import MetricCard from "../../../../components/ui/MetricCard.jsx";

export default function FactoryPlanningWorkloadSummary({ activeSkus, lowStockCount, outOfStockCount, suggestedValue, hasSuggestedProduction, openJobs, onRetry }) {
  const hasDiagnostics = openJobs.hasLoaded
    && (Number(openJobs.diagnostics.missingPackagingSkuCount || 0) > 0 || Number(openJobs.diagnostics.invalidQuantityCount || 0) > 0);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard icon={PackageCheck} label="Planning SKUs" value={activeSkus} helper="Active packaging SKUs" />
        <MetricCard icon={AlertTriangle} label="Low Stock" value={lowStockCount} helper="Below par level" tone={lowStockCount ? "warning" : "success"} />
        <MetricCard icon={Clock3} label="Out of Stock" value={outOfStockCount} helper="Current balance zero" tone={outOfStockCount ? "danger" : "success"} />
        <MetricCard icon={Factory} label="Suggested Production" value={suggestedValue} helper="Needed to reach par" tone={hasSuggestedProduction ? "info" : "success"} />
      </div>
      {openJobs.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 shrink-0" size={16} /><span>{openJobs.error}</span></div>
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={openJobs.loading} onClick={onRetry}>Retry</button>
        </div>
      ) : openJobs.loading ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">{openJobs.hasLoaded ? "Refreshing open Job Order quantities…" : "Loading open Job Order quantities…"}</div>
      ) : null}
      {hasDiagnostics ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Some open Job Orders have incomplete Packaging SKU or quantity data. Suggested Qty is unavailable for affected SKUs.</div>
      ) : null}
    </>
  );
}
