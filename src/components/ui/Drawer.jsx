import { useEffect } from "react";
import { ArrowLeft, X } from "lucide-react";

const widthClasses = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-[720px]",
  xl: "max-w-[880px]",
};

export default function Drawer({
  open = true,
  title,
  description,
  eyebrow,
  children,
  footer,
  onClose,
  onBack,
  backLabel = "Back",
  width = "lg",
  header,
  className = "",
  bodyClassName = "",
  footerClassName = "",
  closeOnOverlay = true,
  closeOnEscape = true,
}) {
  const widthClass = widthClasses[width] ?? widthClasses.lg;

  useEffect(() => {
    if (!open || !closeOnEscape) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-drawer-layer flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button
        className="flex-1 cursor-default"
        type="button"
        aria-label="Close drawer backdrop"
        onClick={closeOnOverlay ? onClose : undefined}
      />
      <aside className={`relative z-modal-content-layer flex h-full w-full ${widthClass} flex-col border-l border-border bg-surface shadow-2xl ${className}`}>
        {header === false ? null : header ?? (
          <header className="sticky top-0 z-sticky-layer shrink-0 border-b border-border bg-surface/95 p-4 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {onBack ? (
                  <button className="mb-2 inline-flex items-center gap-1.5 type-caption font-bold text-text-secondary transition hover:text-primary" type="button" onClick={onBack}>
                    <ArrowLeft size={14} />
                    {backLabel}
                  </button>
                ) : null}
                {eyebrow ? <div className="type-micro font-black uppercase tracking-[0.14em] text-primary">{eyebrow}</div> : null}
                {title ? <h2 className="mt-0.5 truncate type-section-title font-bold text-text-primary">{title}</h2> : null}
                {description ? <p className="mt-1 type-body-sm text-text-secondary">{description}</p> : null}
              </div>
              <button className="icon-btn" type="button" onClick={onClose} aria-label="Close drawer">
                <X size={17} />
              </button>
            </div>
          </header>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${bodyClassName}`}>{children}</div>
        {footer ? (
          <footer className={`sticky bottom-0 z-sticky-layer shrink-0 border-t border-border bg-surface/95 p-3 shadow-[0_-10px_24px_rgba(15,23,42,0.06)] backdrop-blur ${footerClassName}`}>
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
