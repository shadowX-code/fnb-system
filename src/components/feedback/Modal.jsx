const sizeClasses = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-[960px]",
  "2xl": "max-w-[1080px]",
};

export default function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  size = "sm",
  panelClassName = "",
  bodyClassName = "",
  footerClassName = "",
}) {
  const widthClass = sizeClasses[size] ?? sizeClasses.sm;

  return (
    <div className="fixed inset-0 z-modal-layer flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className={`flex max-h-[85vh] w-full ${widthClass} flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-card ${panelClassName}`}>
        <div className="shrink-0 flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <h2 className="type-title font-bold text-text-primary">{title}</h2>
            {description ? <p className="mt-1 type-body-sm text-text-secondary">{description}</p> : null}
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${bodyClassName}`}>{children}</div>
        {footer ? <div className={`sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-border bg-slate-50 p-3 ${footerClassName}`}>{footer}</div> : null}
      </div>
    </div>
  );
}
