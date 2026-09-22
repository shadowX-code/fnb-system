import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import useCrewOverlay from "../hooks/useCrewOverlay.js";

const isFormControl = (node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;

export default function CrewBottomSheet({ title, description, headerIcon, onClose, children, footer, className = "", contentClassName = "", backdropClassName = "", allowBackdropClose = true, closeDisabled = false, initialFocusRef }) {
  const { t } = useTranslation();
  const overlay = useCrewOverlay({ onClose, closeDisabled, initialFocusRef });
  const [viewport, setViewport] = useState(() => ({ height: typeof window === "undefined" ? 0 : window.visualViewport?.height || window.innerHeight, top: typeof window === "undefined" ? 0 : window.visualViewport?.offsetTop || 0 }));
  const dragStartY = useRef(null);
  const contentRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  const updateViewport = useCallback(() => {
    const visualViewport = window.visualViewport;
    setViewport({ height: Math.round(visualViewport?.height || window.innerHeight), top: Math.round(visualViewport?.offsetTop || 0) });
  }, []);

  useEffect(() => {
    updateViewport();
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [updateViewport]);

  const dismissKeyboard = useCallback(() => {
    const active = document.activeElement;
    if (isFormControl(active)) active.blur();
  }, []);

  const requestClose = useCallback(() => {
    if (closeDisabled) return;
    dismissKeyboard();
    onClose();
  }, [closeDisabled, dismissKeyboard, onClose]);

  const setSheetRef = useCallback((node) => {
    overlay.surfaceRef.current = node;
  }, [overlay.surfaceRef]);

  const revealFocusedField = useCallback((event) => {
    const content = contentRef.current;
    const field = event.target;
    if (!content || !isFormControl(field)) return;
    requestAnimationFrame(() => {
      const contentBounds = content.getBoundingClientRect();
      const fieldBounds = field.getBoundingClientRect();
      const padding = 16;
      const scrollBy = (top) => {
        if (typeof content.scrollBy === "function") content.scrollBy({ top, behavior: "smooth" });
        else content.scrollTop += top;
      };
      if (fieldBounds.bottom > contentBounds.bottom - padding) scrollBy(fieldBounds.bottom - contentBounds.bottom + padding);
      if (fieldBounds.top < contentBounds.top + padding) scrollBy(fieldBounds.top - contentBounds.top - padding);
    });
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (event.key !== "Enter" || event.isComposing || !isFormControl(event.target)) return;
    const enterKeyHint = event.target.getAttribute("enterkeyhint");
    if (event.target instanceof HTMLTextAreaElement && enterKeyHint !== "done") return;
    const controls = [...(contentRef.current?.querySelectorAll("input:not([disabled]):not([type='file']), textarea:not([disabled]), select:not([disabled])") || [])];
    const next = controls[controls.indexOf(event.target) + 1];
    if (next && enterKeyHint !== "done") {
      event.preventDefault();
      next.focus();
    } else if (enterKeyHint === "done") {
      event.preventDefault();
      dismissKeyboard();
    }
  }, [dismissKeyboard]);

  if (typeof document === "undefined") return null;
  const viewportStyle = { "--crew-sheet-viewport-height": `${viewport.height || 0}px`, "--crew-sheet-viewport-top": `${viewport.top}px` };
  return createPortal(<div className={`crew-ui-bottom-sheet-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`} style={viewportStyle} role="presentation" onMouseDown={(event) => allowBackdropClose && !closeDisabled && event.target === event.currentTarget && requestClose()}>
    <section ref={setSheetRef} tabIndex={-1} className={`crew-ui-bottom-sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onMouseDown={(event) => event.stopPropagation()}>
      <span className="crew-ui-bottom-sheet-handle" aria-hidden="true" onPointerDown={(event) => { dragStartY.current = event.clientY; }} onPointerUp={(event) => { if (dragStartY.current !== null && event.clientY - dragStartY.current > 72) requestClose(); dragStartY.current = null; }} />
      <header className="crew-ui-bottom-sheet-header">
        {headerIcon ? <span className="crew-ui-bottom-sheet-icon" aria-hidden="true">{headerIcon}</span> : null}
        <div><h2 id={titleId}>{title}</h2>{description ? <p id={descriptionId}>{description}</p> : null}</div>
        <button ref={overlay.closeRef} className="crew-ui-bottom-sheet-close" type="button" onClick={requestClose} aria-label={t("common.close")} disabled={closeDisabled}><X size={19} /></button>
      </header>
      <div ref={contentRef} className={`crew-ui-bottom-sheet-content${contentClassName ? ` ${contentClassName}` : ""}`} onFocusCapture={revealFocusedField} onKeyDown={handleKeyDown} onPointerDown={(event) => { if (event.target === event.currentTarget) dismissKeyboard(); }}>{children}</div>
      {footer ? <footer className="crew-ui-bottom-sheet-footer">{footer}</footer> : null}
    </section>
  </div>, document.body);
}
