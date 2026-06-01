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
  valueClassName = "",
}) {
  const trendColor = tone === "danger" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : "text-emerald-600";
  const Component = onClick ? "button" : "div";
  const compactVariant = variant === "compact";
  const resolvedEmphasis = variant === "primary" ? "primary" : variant === "danger" ? "urgent" : emphasis;
  const resolvedTone = variant && !["primary", "compact"].includes(variant) ? variant : tone;
  const emphasisClass = resolvedEmphasis === "primary"
    ? "metric-card-primary border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/45 shadow-[0_14px_34px_rgba(22,163,74,0.08)]"
    : resolvedEmphasis === "urgent"
      ? "metric-card-urgent border-rose-200/80 bg-gradient-to-br from-white to-rose-50/45 shadow-[0_14px_34px_rgba(244,63,94,0.08)]"
      : "metric-card-normal bg-white";
  const valueClass = valueClassName || (compactVariant
    ? "text-[clamp(30px,2.2vw,34px)]"
    : resolvedEmphasis === "primary"
      ? "text-[clamp(24px,1.65vw,28px)]"
      : "type-metric");
  const sizeClass = compactVariant ? "min-h-[78px] p-3" : size === "compact" ? "min-h-[70px] p-3" : "min-h-[82px] p-3.5";
  const hoverClass = onClick ? "cursor-pointer hover:border-primary/30 hover:bg-primary/5 hover:shadow-card focus:outline-none focus:ring-2 focus:ring-primary/15" : "hover:border-primary/20 hover:shadow-card";
  // Reserved for a future labeled mini-sparkline. Do not render decorative bars
  // unless the chart has clear labels, interaction, and trend meaning.
  void sparklineData;

  return (
    <Component
      className={`card flex w-full flex-col justify-between gap-1.5 text-left transition-colors duration-150 ${sizeClass} ${hoverClass} ${emphasisClass} ${active ? "ring-2 ring-primary/20" : ""} ${resolvedTone === "warning" && resolvedEmphasis === "normal" ? "bg-amber-50/20" : resolvedTone === "danger" && resolvedEmphasis === "normal" ? "bg-rose-50/20" : ""}`}
      type={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {Icon ? (
            <span className={`${compactVariant ? "h-6 w-6 rounded-lg" : "h-5 w-5 rounded-md"} flex shrink-0 items-center justify-center bg-primary/8 text-primary/80`}>
              <Icon size={compactVariant ? 14 : 12} />
            </span>
          ) : null}
          <div className={`${compactVariant ? "text-[11px]" : "text-xs"} truncate font-semibold uppercase tracking-[0.06em] text-text-secondary`}>{label || title}</div>
        </div>
        {status ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 type-micro font-semibold text-text-secondary">{status}</span> : null}
      </div>
      <div className={`mt-0.5 min-w-0 break-words font-semibold leading-tight tracking-tight text-text-primary ${valueClass}`}>{value}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-text-secondary">{helper || subtitle}</span>
        {trend ? <span className={`font-semibold ${trendColor}`}>{trend}</span> : null}
      </div>
      {insight ? <div className="type-caption text-text-muted">{insight}</div> : null}
    </Component>
  );
}
