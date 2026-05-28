const densityClasses = {
  compact: "p-3",
  standard: "p-4",
};

const layoutClasses = {
  full: "",
  split: "grid gap-3 lg:grid-cols-2",
  grid: "grid gap-3 md:grid-cols-2 xl:grid-cols-3",
};

export default function DashboardSection({
  title,
  subtitle,
  action,
  children,
  density = "standard",
  layout = "full",
  className = "",
  contentClassName = "",
}) {
  return (
    <section className={`card ${densityClasses[density] ?? densityClasses.standard} ${className}`}>
      {(title || subtitle || action) ? (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="type-section-title font-bold text-text-primary">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 type-body-sm text-text-secondary">{subtitle}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div className={`${layoutClasses[layout] ?? ""} ${contentClassName}`}>{children}</div>
    </section>
  );
}
