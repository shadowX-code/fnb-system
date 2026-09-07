import { useState } from "react";
import FactoryStatusBadge from "./FactoryStatusBadge.jsx";

const toneClass = {
  neutral: "text-text-primary",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-rose-700 dark:text-rose-300",
  info: "text-sky-700 dark:text-sky-300",
};

export function FactoryOperationalSummary({ items = [], status, actions }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Operational summary">
      <div className="flex flex-wrap divide-x divide-border rounded-lg border border-border bg-surface px-1 py-1">
        {items.map((item) => <div key={item.label} className="px-3 py-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{item.label}</div>
          <div className={`mt-0.5 text-sm font-semibold ${toneClass[item.tone] || toneClass.neutral}`}>{item.value}</div>
        </div>)}
      </div>
      {status ? <div className="ml-1">{status}</div> : null}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function FactoryEvidenceHeader({ title, subtitle, status }) {
  return <header className="border-b border-border pb-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-base font-semibold text-text-primary">{title || "—"}</h3>{subtitle ? <p className="mt-1 text-sm text-text-secondary">{subtitle}</p> : null}</div>
      {status ? <FactoryStatusBadge tone={status.tone || "neutral"}>{status.label}</FactoryStatusBadge> : null}
    </div>
  </header>;
}

export function FactoryEvidenceSection({ title, children }) {
  return <section className="pt-4"><h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{title}</h4>{children}</section>;
}

export function FactoryEvidenceGrid({ items = [] }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
    {items.map((item) => <div key={item.label} className={item.fullWidth ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium text-text-secondary">{item.label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-text-primary">{item.value || "—"}</dd>
    </div>)}
  </dl>;
}

export function FactoryEvidencePreview({ label, items = [], onOpen, onPreview, unavailableLabel = "Evidence unavailable", tone = "success" }) {
  const [visible, setVisible] = useState(false);
  const unavailable = label === unavailableLabel;
  if (!items.length && (!onPreview || unavailable)) return <span className="cursor-help" title="No QC check evidence is available for this Production record.">{unavailableLabel}</span>;
  function preview() { setVisible(true); onPreview?.(); }
  return <span className="relative inline-flex" onMouseEnter={preview} onMouseLeave={() => setVisible(false)} onFocus={preview} onBlur={() => setVisible(false)}>
    <button type="button" className="text-left" aria-label={`View QC evidence: ${label}`} aria-expanded={visible} onClick={onOpen}>
      <FactoryStatusBadge tone={tone}>{label}</FactoryStatusBadge>
    </button>
    {visible ? <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-tooltip-layer mb-2 w-64 rounded-lg border border-border bg-surface p-3 text-left shadow-lg">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">QC checks</span>
      {items.length ? <><span className="block space-y-1.5">{items.slice(0, 4).map((item, index) => <span key={item.id || `${item.qc_name}-${index}`} className="flex items-start justify-between gap-3 text-xs"><span className="min-w-0 text-text-secondary">{item.qc_name || "QC check"}</span><span className={`shrink-0 font-semibold ${toneClass[item.result === "fail" ? "danger" : item.result === "pass" || item.result === "na" ? "success" : "warning"]}`}>{item.result ? String(item.result).toUpperCase() : "RECORDED"}</span></span>)}</span>{items.length > 4 ? <span className="mt-2 block text-xs text-text-muted">+{items.length - 4} more checks</span> : null}</> : <span className="block text-xs text-text-secondary">Loading QC checks…</span>}
    </span> : null}
  </span>;
}
