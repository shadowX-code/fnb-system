import { useId } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import useCrewOverlay from "../hooks/useCrewOverlay.js";

export default function CrewMobileModal({ title, description, onClose, children, footer, className = "", contentClassName = "", closeDisabled = false, allowBackdropClose = true, initialFocusRef, onSubmit }) {
  const { t } = useTranslation();
  const { surfaceRef, closeRef } = useCrewOverlay({ onClose, closeDisabled, initialFocusRef });
  const titleId = useId();
  const descriptionId = useId();
  const Surface = onSubmit ? "form" : "section";
  if (typeof document === "undefined") return null;

  return createPortal(<div className="crew-ui-modal-backdrop" role="presentation" onMouseDown={(event) => allowBackdropClose && !closeDisabled && event.target === event.currentTarget && onClose()}>
    <Surface ref={surfaceRef} tabIndex={-1} className={`crew-ui-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onSubmit={onSubmit}>
      <header className="crew-ui-modal-header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button ref={closeRef} className="crew-ui-modal-close" type="button" onClick={onClose} disabled={closeDisabled} aria-label={t("common.close")}><X size={19} /></button></header>
      <div className={`crew-ui-modal-content ${contentClassName}`}>{children}</div>
      {footer && <footer className="crew-ui-modal-footer">{footer}</footer>}
    </Surface>
  </div>, document.body);
}
