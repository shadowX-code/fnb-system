import { CircleHelp, Info } from "lucide-react";
import "../../../i18n/index.js";
import CrewBottomSheet from "./CrewBottomSheet.jsx";

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
  return <CrewBottomSheet title={title} description={body} onClose={onClose} className="crew-ui-help-sheet" contentClassName="crew-ui-help-sheet-content" backdropClassName="crew-ui-help-backdrop">
    {children}
  </CrewBottomSheet>;
}
