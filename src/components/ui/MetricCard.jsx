export default function MetricCard({ label, value, helper, trend, tone = "neutral", icon: Icon, status, sparklineData, insight, onClick, title }) {
  const trendColor = tone === "danger" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : "text-emerald-600";
  const Component = onClick ? "button" : "div";
  // Reserved for a future labeled mini-sparkline. Do not render decorative bars
  // unless the chart has clear labels, interaction, and trend meaning.
  void sparklineData;

  return (
    <Component
      className={`card flex min-h-[96px] w-full flex-col justify-between gap-2 px-3 py-3 text-left transition duration-150 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-card ${onClick ? "hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/15" : ""} ${tone === "warning" ? "bg-amber-50/25" : tone === "danger" ? "bg-rose-50/25" : ""}`}
      type={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {Icon ? (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary/80">
              <Icon size={12} />
            </span>
          ) : null}
          <div className="truncate text-[12px] font-semibold text-text-secondary">{label}</div>
        </div>
        {status ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">{status}</span> : null}
      </div>
      <div className="mt-0.5 min-w-0 break-words text-[clamp(20px,1.45vw,26px)] font-semibold leading-tight tracking-tight text-text-primary">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs leading-4">
        <span className="min-w-0 truncate text-text-secondary">{helper}</span>
        {trend ? <span className={`font-semibold ${trendColor}`}>{trend}</span> : null}
      </div>
      {insight ? <div className="text-xs leading-4 text-text-muted">{insight}</div> : null}
    </Component>
  );
}
