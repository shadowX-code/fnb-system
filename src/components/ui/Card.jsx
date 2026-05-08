export default function Card({ title, description, action, children, className = "" }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            {title ? <h2 className="text-sm font-bold text-text-primary">{title}</h2> : null}
            {description ? <p className="mt-1 text-xs text-text-secondary">{description}</p> : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
