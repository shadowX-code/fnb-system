import { useEffect, useId, useRef } from "react";
import { CircleHelp, Info, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";

export function CrewHelpTrigger({ label, onClick, variant = "inline" }) {
  const Icon = variant === "header" ? CircleHelp : Info;
  return <button className={`crew-ui-help-trigger is-${variant}`} type="button" aria-label={label} onClick={onClick}><Icon size={variant === "header" ? 21 : 16} aria-hidden="true" /></button>;
}

export function CrewHelpTable({ columns, rows, label }) {
  return <div className={`crew-ui-help-table is-columns-${columns.length}`} role="table" aria-label={label}>
    <div className="crew-ui-help-table-header" role="row">{columns.map((column) => <span key={column} role="columnheader">{column}</span>)}</div>
    {rows.map((row) => <div className="crew-ui-help-table-row" key={row.key || row.cells.join("|")} role="row">{row.cells.map((cell, index) => <span className={cell.emphasis ? "is-emphasized" : ""} key={`${row.key || row.cells.join("|")}-${index}`} role="cell">{cell.value}</span>)}</div>)}
  </div>;
}

export function CrewHelpRows({ rows }) {
  return <dl className="crew-ui-help-rows">{rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}

export function CrewHelpSheet({ title, body, onClose, children }) {
  const { t } = useTranslation();
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const bodyId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousBodyStyles = { overflow: document.body.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(sheetRef.current?.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") || [])];
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
      if (!navigator.userAgent.includes("jsdom")) window.scrollTo(0, scrollY);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(<div className="crew-ui-help-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={sheetRef} className="crew-ui-help-sheet" role="dialog" aria-modal="true" aria-labelledby={`${bodyId}-title`} aria-describedby={body ? bodyId : undefined} onMouseDown={(event) => event.stopPropagation()}>
      <header className="crew-ui-help-sheet-header"><h2 id={`${bodyId}-title`}>{title}</h2><button ref={closeRef} className="crew-ui-help-sheet-close" type="button" onClick={onClose} aria-label={t("common.close")}><X size={19} /></button></header>
      <div className="crew-ui-help-sheet-content">{body ? <p id={bodyId} className="crew-ui-help-sheet-body">{body}</p> : null}{children}</div>
    </section>
  </div>, document.body);
}
