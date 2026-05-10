export default function FilterBar({ children, actions, compact = false, className = "" }) {
  return (
    <div className={`card flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between ${compact ? "p-2" : "p-2.5"} ${className}`}>
      <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
      {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}
    </div>
  );
}
