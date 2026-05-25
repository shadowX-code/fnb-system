export default function Card({ title, description, action, children, className = "" }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-border px-3.5 py-2.5">
          <div>
            {title ? <h2 className="type-title font-bold text-text-primary">{title}</h2> : null}
            {description ? <p className="mt-0.5 type-caption text-text-secondary">{description}</p> : null}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
