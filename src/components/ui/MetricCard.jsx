export default function MetricCard({ label, value, helper, trend, tone = "neutral", icon: Icon, status, sparklineData, onClick, title }) {
  const trendColor = tone === "danger" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : "text-emerald-600";
  const maxValue = Math.max(...(sparklineData ?? []).map((item) => Number(item.value) || 0), 1);
  const Component = onClick ? "button" : "div";

  return (
    <Component
      className={`card w-full px-2.5 py-2 text-left transition ${onClick ? "hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/15" : ""} ${tone === "warning" ? "bg-amber-50/25" : tone === "danger" ? "bg-rose-50/25" : ""}`}
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
      {sparklineData?.length ? (
        <div className="mt-1 flex h-3 items-end gap-0.5" aria-label={`${label} recent trend`}>
          {sparklineData.map((item) => {
            const height = Math.max(16, (Number(item.value) / maxValue) * 100);
            return (
              <span
                key={item.label}
                title={`${item.label}: ${item.display ?? item.value}`}
                className={`w-full rounded-t transition hover:opacity-80 ${
                  item.current
                    ? tone === "warning"
                      ? "bg-amber-500"
                      : tone === "danger"
                        ? "bg-rose-500"
                        : "bg-primary"
                    : tone === "warning"
                      ? "bg-amber-200"
                      : tone === "danger"
                        ? "bg-rose-200"
                        : "bg-primary/25"
                }`}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
      ) : null}
    </Component>
  );
}
