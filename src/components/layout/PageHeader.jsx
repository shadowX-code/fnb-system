export default function PageHeader({
  section,
  title,
  description,
  actions,
  secondaryActions,
  primaryActions,
  breadcrumbs,
  metadata,
  variant,
}) {
  const groupedActions = secondaryActions || primaryActions;
  const actionContent = groupedActions ? (
    <>
      {secondaryActions ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-page-header-secondary-actions
        >
          {secondaryActions}
        </div>
      ) : null}
      {primaryActions ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-page-header-primary-actions
        >
          {primaryActions}
        </div>
      ) : null}
    </>
  ) : (
    actions
  );

  return (
    <div className={`space-y-3 ${variant === "context" ? "admin-context-identity" : ""}`} data-page-header>
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumb" className="text-xs text-text-secondary">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumbs.map((item, index) => (
              <li
                key={`${index}-${item.label}`}
                className="flex min-w-0 items-center gap-1"
              >
                {index > 0 ? (
                  <span aria-hidden="true" className="px-1 text-text-muted">
                    /
                  </span>
                ) : null}
                {item.onClick ? (
                  <button
                    type="button"
                    className="btn-ghost !h-auto !min-h-0 !px-1 !py-1 text-xs"
                    onClick={item.onClick}
                  >
                    {item.label}
                  </button>
                ) : (
                  <span
                    aria-current={
                      index === breadcrumbs.length - 1 ? "page" : undefined
                    }
                  >
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {section ? (
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {section}
            </p>
          ) : null}
          <h1 className="mt-0.5 truncate type-page-title font-bold tracking-tight text-text-primary">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 max-w-3xl text-sm text-text-secondary">
              {description}
            </p>
          ) : null}
          {metadata ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-secondary"
              data-page-header-metadata
            >
              {metadata}
            </div>
          ) : null}
        </div>
        {actionContent ? (
          <div
            className="flex w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 md:justify-end"
            data-page-header-actions
          >
            {actionContent}
          </div>
        ) : null}
      </div>
    </div>
  );
}
