/**
 * Shared Admin table surface. The feature supplies its domain copy and actions;
 * this component keeps the surrounding table hierarchy consistent.
 */
export default function AdminDataSection({ title, description, actions = null, children, className = "" }) {
  return (
    <section className={`card overflow-hidden ${className}`.trim()}>
      {title ? (
        <header className="admin-data-section-header">
          <div className="min-w-0">
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="admin-data-section-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
