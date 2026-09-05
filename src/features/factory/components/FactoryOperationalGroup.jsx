export default function FactoryOperationalGroup({ title, count, children }) {
  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <span className="text-xs font-semibold text-text-muted">{count}</span>
      </header>
      <div className="divide-y divide-border/80">{children}</div>
    </section>
  );
}

export function FactoryOperationalRow({ primary, secondary, status, actions, onOpen }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition hover:bg-primary/5">
      <button className="min-w-0 flex-1 text-left" type="button" onClick={onOpen}>
        <span className="block text-sm font-semibold text-text-primary">{primary}</span>
        {secondary ? <span className="mt-0.5 block truncate text-xs text-text-secondary">{secondary}</span> : null}
      </button>
      <div className="shrink-0">{status}</div>
      <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{actions}</div>
    </div>
  );
}
