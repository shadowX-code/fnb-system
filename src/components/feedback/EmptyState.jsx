export default function EmptyState({ title = "No records found", description = "Try adjusting filters or add a new record.", icon: Icon, actions, className = "" }) {
  return (
    <div className={`rounded-2xl border border-dashed border-border bg-slate-50 p-8 text-center ${className}`.trim()}>
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-text-secondary">
        {Icon ? <Icon size={20} aria-hidden="true" /> : "—"}
      </div>
      <p className="mt-3 text-sm font-bold text-text-primary">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{description}</p>
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
