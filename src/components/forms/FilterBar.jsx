export default function FilterBar({ children, actions, compact = false }) {
  return (
    <div className={`card flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between ${compact ? "p-2.5" : "p-3"}`}>
      <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
