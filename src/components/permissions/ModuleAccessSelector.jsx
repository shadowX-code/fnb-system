import { useId } from "react";
import { ChevronDown } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import "./moduleAccessSelector.css";

export const actionLabels = { view: "View Records", list: "View Records", read: "View Records", search: "View Records", filter: "View Records", draft: "Draft", execute: "Execute", approve: "Approve" };
export default function ModuleAccessSelector({ capabilities = [], canManage = false, busy = false, onChange, onChangeMany, selection, onSelect, onSelectMany }) {
  const id = useId(), groups = new Map();
  for (const row of capabilities) {
    const key = `${row.workspace}:${row.section}`;
    if (!groups.has(key)) groups.set(key, { workspace: row.workspace, label: row.section, rows: [] });
    groups.get(key).rows.push(row);
  }
  const selected = (row) => selection ? selection.includes(row.name) : row.granted;
  function changeGroup(rows, checked) {
    const changes = rows.filter((row) => row.implemented && row.can_assign && selected(row) !== checked);
    if (selection) onSelectMany?.(changes.map((row) => row.name), checked);
    else onChangeMany?.(changes, checked);
  }
  return <div className="module-access-selector"><p className="text-xs text-text-secondary">Select the business modules this agent may view. Partial means only the described records are available. Related modules are never added automatically. Draft, Execute and Approve are unavailable.</p>{[...groups.entries()].map(([key, group]) => {
    const available = group.rows.filter((row) => row.implemented), count = available.filter(selected).length, preserved = group.rows.filter((row) => row.limited_access).length;
    return <details key={key} className="module-access-group">
      <summary><ChevronDown className="module-access-chevron" size={16} aria-hidden="true" /><span><span className="text-xs font-normal text-text-secondary">{group.workspace} / </span>{group.label}</span><span className="module-access-count">{count} of {available.length} selected</span></summary>
      <div className="module-access-toolbar"><span className="text-xs text-text-secondary">{available.length} modules available{available.length < group.rows.length ? ` · ${group.rows.length - available.length} unavailable` : ""}{preserved > 0 ? ` · ${preserved} with preserved access` : ""}</span>{(selection || canManage) && <div className="flex gap-3"><button type="button" disabled={busy || !available.some((row) => row.can_assign && !selected(row))} onClick={() => changeGroup(group.rows, true)}>Select all</button><button type="button" disabled={busy || !available.some((row) => row.can_assign && selected(row))} onClick={() => changeGroup(group.rows, false)}>Clear</button></div>}</div>
      <ul>{group.rows.map((row) => <li key={row.name}>
        <label className="module-access-option"><input type="checkbox" checked={!!selected(row)} disabled={busy || !row.implemented || !row.can_assign || (!selection && !canManage)} aria-label={`View Records: ${row.label}`} aria-describedby={`${id}-${row.name}`} onChange={(event) => selection ? onSelect(row.name, event.target.checked) : onChange(row)} /><span><span className="module-access-title"><span className="font-semibold">{row.label}</span>{row.limited_access && <span className="module-access-preserved">Preserved restricted access</span>}{row.sidebar === false && <span className="module-access-related">Related route</span>}</span><span id={`${id}-${row.name}`} className="module-access-description">{row.description}</span>{row.required_modules?.length > 0 && <span className="module-access-description">Requires: {row.required_modules.map((module) => module.label).join(", ")}.</span>}</span></label>
        <span className="module-access-state"><Badge tone={row.coverage === "available" ? "success" : row.coverage === "partial" ? "warning" : "neutral"}>{row.coverage === "available" ? "Available" : row.coverage === "partial" ? "Partial" : "Unavailable"}</Badge><span className="text-xs text-text-secondary">View Records</span></span>
      </li>)}</ul>
    </details>;
  })}</div>;
}
