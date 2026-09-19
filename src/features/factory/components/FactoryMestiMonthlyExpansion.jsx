export function FactoryMestiMonthlyExpansion({ title, ariaLabel, children }) {
  return <div className="border border-border bg-surface" aria-label={ariaLabel}>
    {title ? <div className="border-b border-border px-3 py-2 text-xs font-semibold text-text-secondary">{title}</div> : null}
    <div className="divide-y divide-border">{children}</div>
  </div>;
}

export function FactoryMestiMonthlyActionRow({ primary, secondary, evidence, status, actions }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
    <div className="min-w-0 flex-1 basis-56">
      <div className="min-w-0 text-sm font-semibold text-text-primary">{primary}</div>
      {secondary ? <div className="mt-0.5 min-w-0 text-xs text-text-secondary">{secondary}</div> : null}
      {evidence ? <div className="mt-1 min-w-0 text-xs text-text-muted">{evidence}</div> : null}
    </div>
    <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
      {status}
      {actions}
    </div>
  </div>;
}
