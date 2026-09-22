import { useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import useCrewOverlay from "../hooks/useCrewOverlay.js";

export default function CrewImageViewer({ src, alt = "Image", title = "Image preview", onClose }) {
  const { t } = useTranslation();
  const overlay = useCrewOverlay({ onClose, closeDisabled: false });
  const titleId = useId();
  if (typeof document === "undefined") return null;
  return createPortal(<div className="crew-ui-image-viewer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={overlay.surfaceRef} tabIndex={-1} className="crew-ui-image-viewer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">{title}</h2>
      <button ref={overlay.closeRef} type="button" onClick={onClose} aria-label={t("common.close")}><X size={21} /></button>
      <img src={src} alt={alt} />
    </section>
  </div>, document.body);
}
