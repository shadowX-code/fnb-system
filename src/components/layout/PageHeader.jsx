export default function PageHeader({ section, title, description, actions }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {section ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{section}</p> : null}
        <h1 className="mt-0.5 truncate text-2xl font-bold leading-tight tracking-tight text-text-primary">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
