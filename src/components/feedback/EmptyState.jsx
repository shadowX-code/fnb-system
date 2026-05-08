export default function EmptyState({ title = "No records found", description = "Try adjusting filters or add a new record." }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-8 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-text-secondary">
        —
      </div>
      <p className="mt-3 text-sm font-bold text-text-primary">{title}</p>
      <p className="mt-1 text-sm text-text-secondary">{description}</p>
    </div>
  );
}
