export default function MetricCard({
  label,
  title,
  value,
  helper,
  subtitle,
  trend,
  tone = "neutral",
  variant,
  icon: Icon,
  status,
  sparklineData,
  insight,
  onClick,
  active = false,
  size = "standard",
  emphasis = "normal",
  presentation = "default",
  action,
  valueClassName = "",
  className = "",
  iconClassName = "",
}) {
  const trendColor = tone === "danger" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : "text-emerald-600";
  const Component = onClick ? "button" : "div";
  const compactVariant = variant === "compact";
  const isSummary = presentation === "summary";
  const resolvedEmphasis = variant === "primary" ? "primary" : variant === "danger" ? "urgent" : emphasis;
  const resolvedTone = variant && !["primary", "compact"].includes(variant) ? variant : tone;
  const emphasisClass = isSummary
    ? resolvedEmphasis === "primary" ? "border-primary/30 bg-white shadow-none" : "border-border bg-white shadow-none"
    : resolvedEmphasis === "primary"
    ? "metric-card-primary border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/45 shadow-[0_14px_34px_rgba(22,163,74,0.08)]"
    : resolvedEmphasis === "urgent"
      ? "metric-card-urgent border-rose-200/80 bg-gradient-to-br from-white to-rose-50/45 shadow-[0_14px_34px_rgba(244,63,94,0.08)]"
      : "metric-card-normal bg-white";
  const valueClass = valueClassName || "text-primary-type-kpi-value";
  const valueBaseClass = "";
  const sizeClass = isSummary
    ? size === "compact" ? "min-h-[86px] p-3" : "min-h-[108px] p-4"
    : compactVariant ? "min-h-[70px] p-2.5" : size === "compact" ? "min-h-[70px] p-3" : "min-h-[82px] p-3.5";
  const hoverClass = onClick ? "cursor-pointer hover:border-primary/30 hover:bg-primary/5 hover:shadow-card focus:outline-none focus:ring-2 focus:ring-primary/15" : "hover:border-primary/20 hover:shadow-card";
  const iconToneClass = tone === "danger"
    ? "bg-rose-50 text-rose-700"
    : tone === "warning"
      ? "bg-amber-50 text-amber-700"
      : tone === "success"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-primary/8 text-primary/80";
  // Reserved for a future labeled mini-sparkline. Do not render decorative bars
  // unless the chart has clear labels, interaction, and trend meaning.
  void sparklineData;

  return (
    <Component
      className={`card flex w-full flex-col justify-between gap-1.5 text-left transition-colors duration-150 ${sizeClass} ${hoverClass} ${emphasisClass} ${active ? "ring-2 ring-primary/20" : ""} ${!isSummary && resolvedTone === "warning" && resolvedEmphasis === "normal" ? "bg-amber-50/20" : !isSummary && resolvedTone === "danger" && resolvedEmphasis === "normal" ? "bg-rose-50/20" : ""} ${className}`}
      type={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
      data-admin-summary-card={isSummary ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {Icon ? (
            <span className={`${compactVariant ? "h-5 w-5 rounded-md" : isSummary ? "h-7 w-7 rounded-lg" : "h-5 w-5 rounded-md"} flex shrink-0 items-center justify-center ${iconClassName || (isSummary ? iconToneClass : "bg-primary/8 text-primary/80")}`}>
              <Icon size={compactVariant ? 12 : isSummary ? 14 : 12} />
            </span>
          ) : null}
          <div className={`${compactVariant || isSummary ? "text-[11px]" : "text-xs"} truncate font-medium ${isSummary ? "tracking-normal" : "uppercase tracking-[0.06em]"} text-text-secondary`}>{label || title}</div>
        </div>
        {status ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 type-micro font-semibold text-text-secondary">{status}</span> : null}
      </div>
      <div className={`mt-0.5 min-w-0 break-words tracking-tight text-text-primary ${valueBaseClass} ${valueClass}`}>{value}</div>
      {helper || subtitle || trend ? <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-text-secondary">{helper || subtitle}</span>
        {trend ? <span className={`font-semibold ${trendColor}`}>{trend}</span> : null}
      </div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
      {insight ? <div className="type-caption text-text-muted">{insight}</div> : null}
    </Component>
  );
}
