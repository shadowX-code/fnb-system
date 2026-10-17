import { useEffect, useLayoutEffect, useRef } from "react";
const sizeClasses = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-[960px]",
  "2xl": "max-w-[1080px]",
  "3xl": "max-w-[1240px]",
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
  headerActions,
  placement = "center",
}) {
  const panelRef = useRef(null), bodyRef = useRef(null), previousTitle = useRef(title), closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement, panel = panelRef.current;
    const controls = () => [...panel.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length && el.closest('[role="dialog"]') === panel);
    panel.focus();
    const key = event => {
      if (event.target.closest('[role="dialog"]') !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); }
      if (event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {event.preventDefault();first.focus();}
    };
    panel.addEventListener('keydown', key);
    return () => {panel.removeEventListener('keydown', key);if(previous?.isConnected)previous.focus?.();};
  }, []);
  useLayoutEffect(() => {
    if (previousTitle.current === title) return;
    previousTitle.current = title;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    panelRef.current?.focus();
  }, [title]);
  const widthClass = sizeClasses[size] ?? sizeClasses.sm;

  return (
    <div className={`fixed inset-0 z-modal-layer flex ${placement === "right" ? "items-stretch justify-end bg-slate-950/10" : "items-center justify-center p-4 bg-slate-950/30 backdrop-blur-sm"}`}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`relative z-modal-content-layer flex ${placement === "right" ? "h-[100dvh] max-w-[560px] rounded-none" : `max-h-[85vh] ${widthClass} rounded-2xl`} w-full flex-col overflow-clip border border-border bg-[var(--theme-surface-raised)] shadow-card ${panelClassName}`}>
        <div className="shrink-0 flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <h2 className="type-title font-bold text-text-primary">{title}</h2>
            {description ? <p className="mt-1 type-body-sm text-text-secondary">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close modal">
              ×
            </button>
          </div>
        </div>
        <div ref={bodyRef} className={`min-h-0 flex-1 overflow-y-auto p-4 ${bodyClassName}`}>{children}</div>
        {footer ? <div className={`sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-border bg-[var(--theme-surface-nested)] p-3 ${footerClassName}`}>{footer}</div> : null}
      </div>
    </div>
  );
}
