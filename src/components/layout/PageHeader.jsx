export default function PageHeader({ section, title, description, actions, secondaryActions, primaryActions }) {
  const groupedActions = secondaryActions || primaryActions;
  const actionContent = groupedActions ? <>
    {secondaryActions ? <div className="flex flex-wrap items-center gap-2" data-page-header-secondary-actions>{secondaryActions}</div> : null}
    {primaryActions ? <div className="flex flex-wrap items-center gap-2" data-page-header-primary-actions>{primaryActions}</div> : null}
  </> : actions;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        {section ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{section}</p> : null}
        <h1 className="mt-0.5 truncate type-page-title font-bold tracking-tight text-text-primary">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-text-secondary">{description}</p> : null}
      </div>
      {actionContent ? <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end" data-page-header-actions>{actionContent}</div> : null}
    </div>
  );
}
