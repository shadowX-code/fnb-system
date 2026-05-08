export default function MetricCard({ label, value, helper, trend, tone = "neutral", icon: Icon, status }) {
  const trendColor = tone === "danger" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : "text-emerald-600";

  return (
    <div className={`card p-5 ${tone === "warning" ? "bg-amber-50/40" : tone === "danger" ? "bg-rose-50/40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {Icon ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon size={17} />
            </span>
          ) : null}
          <div className="text-xs font-semibold text-text-secondary">{label}</div>
        </div>
        {status ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-text-secondary">{status}</span> : null}
      </div>
      <div className="mt-4 text-2xl font-bold tracking-tight text-text-primary">{value}</div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-text-secondary">{helper}</span>
        {trend ? <span className={`font-semibold ${trendColor}`}>{trend}</span> : null}
      </div>
      <div className="mt-4 flex h-8 items-end gap-1">
        {[34, 45, 38, 58, 52, 70, 84].map((height, index) => (
          <span key={index} className={`w-full rounded-t ${tone === "warning" ? "bg-amber-400" : tone === "danger" ? "bg-rose-400" : "bg-primary/70"}`} style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}
