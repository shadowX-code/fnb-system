import { ChevronDown } from "lucide-react";
import Badge from "../../components/ui/Badge.jsx";

export const actionLabels = { view: "View Records", list: "View Records", read: "View Records", search: "View Records", filter: "View Records", draft: "Draft", execute: "Execute", approve: "Approve" };
export default function AgentCapabilities({ capabilities = [], canManage = false, busy = false, onChange, onChangeMany, selection, onSelect, onSelectMany }) {
  const groups = new Map();
  for (const row of capabilities.filter((item) => item.resource_key || !item.implemented)) {
    const key = `${row.workspace}:${row.domain}`;
    if (!groups.has(key)) groups.set(key, { workspace: row.workspace, label: row.domain_label, rows: [] });
    groups.get(key).rows.push(row);
  }
  const selected = (row) => selection ? selection.includes(row.name) : row.granted;
  function changeGroup(rows, checked) {
    const changes = rows.filter((row) => row.implemented && row.can_assign && selected(row) !== checked);
    if (selection) onSelectMany?.(changes.map((row) => row.name), checked);
    else onChangeMany?.(changes, checked);
  }
  return <div className="agent-permission-selector"><p className="text-xs text-text-secondary">View Records includes browsing, searching and filtering. Related records need their own access. Draft, Execute and Approve are unavailable.</p>{[...groups.entries()].map(([key, group]) => {
    const count = group.rows.filter(selected).length;
    const editable = group.rows.filter((row) => row.implemented && row.can_assign);
    return <details key={key} className="agent-permission-group">
      <summary><ChevronDown className="agent-permission-chevron" size={16} aria-hidden="true" /><span><span className="text-xs font-normal text-text-secondary">{group.workspace} / </span>{group.label}</span><span className="agent-permission-count">{count} of {group.rows.length} selected</span></summary>
      {(selection || canManage) && <div className="agent-permission-toolbar"><span className="text-xs text-text-secondary">{group.rows.length} resources</span><div className="flex gap-3"><button type="button" disabled={busy || !editable.some((row) => !selected(row))} onClick={() => changeGroup(group.rows, true)}>Select all</button><button type="button" disabled={busy || !editable.some(selected)} onClick={() => changeGroup(group.rows, false)}>Clear</button></div></div>}
      <ul>{group.rows.map((row) => <li key={row.name}>
        <label className="agent-permission-option"><input type="checkbox" checked={!!selected(row)} disabled={busy || !row.implemented || !row.can_assign || (!selection && !canManage)} aria-label={`${actionLabels[row.capability] || "Unavailable"}: ${row.resource_label || row.label}`} onChange={(event) => selection ? onSelect(row.name, event.target.checked) : onChange(row)} /><span><span className="font-semibold">{row.resource_label || row.label}</span><span className="agent-permission-description">{row.resource_description || row.description}</span>{row.dependencies?.length > 0 && <span className="agent-permission-description">Also requires {row.dependencies.map((slug) => capabilities.find((cap) => cap.name === `factory_${slug}_view`)?.resource_label || slug.replaceAll("_", " ")).join(", ")}.</span>}{row.requires_human_approval && <span className="agent-permission-description">Human approval required for this action.</span>}</span></label>
        {row.implemented ? <span className="text-xs text-text-secondary">{actionLabels[row.capability]}</span> : <Badge tone="neutral">Unavailable</Badge>}
      </li>)}</ul>
    </details>;
  })}</div>;
}
