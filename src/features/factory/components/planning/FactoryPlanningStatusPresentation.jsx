import Badge from "../../../../components/ui/Badge.jsx";
import { percent } from "../../utils/factoryFormatters.js";
import { planningCoveragePercent, planningStatusTone } from "../../utils/factoryPlanningFormatters.js";

function planningCoverageClass(status) {
  return status === "Healthy" ? "bg-emerald-500" : status === "Low Stock" ? "bg-amber-500" : "bg-rose-500";
}

export function FactoryPlanningStatusBadge({ status }) {
  return <Badge tone={planningStatusTone(status)}>{status}</Badge>;
}

export function FactoryPlanningCoverage({ status, value, variant = "desktop" }) {
  const coverage = planningCoveragePercent(value);

  if (variant === "mobile") {
    return (
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
          <span>Coverage</span>
          <span>{coverage == null ? "—" : percent(value)}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-slate-100">
          {coverage == null ? null : <div className={`h-2 rounded-full ${planningCoverageClass(status)}`} style={{ width: `${coverage}%` }} />}
        </div>
      </div>
    );
  }

  if (coverage == null) return <span className="font-bold text-text-secondary">—</span>;
  return (
    <div className="space-y-1">
      <div className="font-bold text-text-primary">{percent(value)}</div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${planningCoverageClass(status)}`} style={{ width: `${coverage}%` }} />
      </div>
    </div>
  );
}
