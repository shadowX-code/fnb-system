import { useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import useCrewOverlay from "../hooks/useCrewOverlay.js";

export default function CrewBottomSheet({ title, description, headerIcon, onClose, children, footer, className = "", contentClassName = "", backdropClassName = "", allowBackdropClose = true, closeDisabled = false, initialFocusRef }) {
  const { t } = useTranslation();
  const { surfaceRef: sheetRef, closeRef } = useCrewOverlay({ onClose, closeDisabled, initialFocusRef });
  const titleId = useId();
  const descriptionId = useId();

  if (typeof document === "undefined") return null;
  return createPortal(<div className={`crew-ui-bottom-sheet-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`} role="presentation" onMouseDown={(event) => allowBackdropClose && !closeDisabled && event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} tabIndex={-1} className={`crew-ui-bottom-sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onMouseDown={(event) => event.stopPropagation()}>
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
