export default function FactoryOperationalGroup({ title, count, children }) {
  return (
    <section className="border-b border-border last:border-b-0">
      <header className="flex items-center justify-between gap-3 border-l-2 border-primary/40 bg-surface-muted/50 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-text-primary">{title}</h2>
        <span className="text-xs font-semibold text-text-muted">{count}</span>
      </header>
      <div className="divide-y divide-border/80">{children}</div>
    </section>
  );
}

export function FactoryOperationalEvidence({ items = [] }) {
  const visibleItems = items.filter(Boolean);
  if (!visibleItems.length) return null;
  return <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-text-secondary">{visibleItems.map((item, index) => <span key={item.key || index} className="max-w-full truncate" title={item.title}>{item.label}</span>)}</span>;
}

export function FactoryOperationalRow({ primary, secondary, evidence, status, actions }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition hover:bg-primary/5">
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">{primary}</span>
        {secondary ? <span className="mt-0.5 block truncate text-xs text-text-secondary">{secondary}</span> : null}
        {evidence}
      </div>
      <div className="shrink-0">{status}</div>
      <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{actions}</div>
    </div>
  );
}
