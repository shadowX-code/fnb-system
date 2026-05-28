export default function PageHeader({ section, title, description, actions }) {
  return (
    <div className="flex flex-col gap-1.5 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {section ? <p className="type-caption font-semibold uppercase tracking-[0.12em] text-primary">{section}</p> : null}
        <h1 className="mt-0.5 truncate type-page-title font-bold tracking-tight text-text-primary">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl type-body-sm text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
