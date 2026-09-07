import MetricCard from "../../../components/ui/MetricCard.jsx";
import { ChartNoAxesColumn } from "lucide-react";

const toneIconClass = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  neutral: "bg-slate-500/10 text-text-secondary",
};

export default function FactorySummaryCard({ variant = "standard", tone = "neutral", icon: Icon = ChartNoAxesColumn, iconClassName, ...props }) {
  return <MetricCard {...props} icon={Icon} tone={tone} variant={variant === "compact" ? "compact" : undefined} iconClassName={iconClassName || toneIconClass[tone] || toneIconClass.neutral} />;
}

export function FactorySummaryCardGroup({ children, status, actions, label = "Summary cards" }) {
  return <div className="flex flex-wrap items-start gap-3" aria-label={label}>
    <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-3">{children}</div>
    {status || actions ? <div className="flex min-h-[70px] flex-wrap items-center justify-end gap-2">{status}{actions}</div> : null}
  </div>;
}
