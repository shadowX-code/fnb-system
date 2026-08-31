import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";

export default function CrewBottomSheet({ title, description, headerIcon, onClose, children, footer, className = "", contentClassName = "", backdropClassName = "", allowBackdropClose = true, closeDisabled = false, initialFocusRef }) {
  const { t } = useTranslation();
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousBodyStyles = { overflow: document.body.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    (initialFocusRef?.current || closeRef.current)?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !closeDisabled) return onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(sheetRef.current?.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") || [])].filter((element) => !element.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      Object.assign(document.body.style, previousBodyStyles);
      document.removeEventListener("keydown", onKeyDown);
      if (scrollY && typeof process === "undefined") window.scrollTo(0, scrollY);
      previousFocus?.focus?.();
    };
  }, [closeDisabled, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(<div className={`crew-ui-bottom-sheet-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`} role="presentation" onMouseDown={(event) => allowBackdropClose && !closeDisabled && event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} className={`crew-ui-bottom-sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onMouseDown={(event) => event.stopPropagation()}>
      <span className="crew-ui-bottom-sheet-handle" aria-hidden="true" />
      <header className="crew-ui-bottom-sheet-header">
        {headerIcon ? <span className="crew-ui-bottom-sheet-icon" aria-hidden="true">{headerIcon}</span> : null}
        <div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
        <button ref={closeRef} className="crew-ui-bottom-sheet-close" type="button" onClick={onClose} aria-label={t("common.close")} disabled={closeDisabled}><X size={19} /></button>
      </header>
      <div className={`crew-ui-bottom-sheet-content${contentClassName ? ` ${contentClassName}` : ""}`}>{children}</div>
      {footer ? <footer className="crew-ui-bottom-sheet-footer">{footer}</footer> : null}
    </section>
  </div>, document.body);
}
