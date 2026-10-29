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
  return <div className="module-access-selector"><p className="text-xs text-text-secondary">Select which modules this agent may view. Capability coverage is separate from access. Related permissions are never added automatically. Draft, Execute and Approve are unavailable.</p>{[...groups.entries()].map(([key, group]) => {
    const available = group.rows.filter((row) => row.implemented), count = available.filter(selected).length, preserved = group.rows.filter((row) => row.limited_access).length;
    return <details key={key} className="module-access-group">
      <summary><ChevronDown className="module-access-chevron" size={16} aria-hidden="true" /><span><span className="text-xs font-normal text-text-secondary">{group.workspace} / </span>{group.label}</span><span className="module-access-count">{count} of {available.length} selected</span></summary>
      <div className="module-access-toolbar"><span className="text-xs text-text-secondary">{available.length} selectable modules{available.length < group.rows.length ? ` · ${group.rows.length - available.length} unavailable` : ""}{preserved > 0 ? ` · ${preserved} with preserved access` : ""}</span>{(selection || canManage) && <div className="flex gap-3"><button type="button" disabled={busy || !available.some((row) => row.can_assign && !selected(row))} onClick={() => changeGroup(group.rows, true)}>Select all</button><button type="button" disabled={busy || !available.some((row) => row.can_assign && selected(row))} onClick={() => changeGroup(group.rows, false)}>Clear</button></div>}</div>
      <ul>{group.rows.map((row) => <li key={row.name}>
        <div className="module-access-main"><label className="module-access-option"><input type="checkbox" checked={!!selected(row)} disabled={busy || !row.implemented || !row.can_assign || (!selection && !canManage)} aria-label={`View Records: ${row.label}`} aria-describedby={`${id}-${row.name}`} onChange={(event) => selection ? onSelect(row.name, event.target.checked) : onChange(row)} /><span className="module-access-title"><span className="font-semibold">{row.label}</span>{row.sidebar === false && <span className="module-access-related">Related route</span>}</span></label>

        <details className="module-access-details"><summary>Access Details<span className="sr-only"> for {row.label}</span></summary><div id={`${id}-${row.name}`}>
          <p>Capability Coverage: {(row.capability_coverage || row.coverage || "unavailable").replace(/^./, (c) => c.toUpperCase())}</p>
          <p>Agent Access: {selected(row) ? "Allowed" : "Not Allowed"} — View Records</p>
          {row.capability_limitation && <p>{row.capability_limitation}</p>}<p>{row.data_limitations || row.description}</p>
          {row.limited_access && <p>Preserved restricted access remains separate from this module selection.</p>}
          {row.required_modules?.length > 0 && <p>Some records also require: {row.required_modules.map((module) => module.label).join(", ")}.</p>}
        </div></details></div>
        <span className="module-access-state">{(row.capability_coverage || row.coverage) !== "available" && <Badge tone={row.coverage === "limited" ? "warning" : "neutral"}>{row.coverage === "limited" ? "Limited" : "Unavailable"}</Badge>}<span className="text-xs text-text-secondary">{selected(row) ? "Allowed" : "Not Allowed"}</span></span>
      </li>)}</ul>
    </details>;
  })}</div>;
}
