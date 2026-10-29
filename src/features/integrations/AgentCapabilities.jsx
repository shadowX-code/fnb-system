import DataTable from "../../components/tables/DataTable.jsx";
import Badge from "../../components/ui/Badge.jsx";

export const actionLabels = { read: "Read", draft: "Draft", execute: "Execute", approve: "Approve" };
export default function AgentCapabilities({ capabilities = [], canManage = false, busy = false, onChange, selection, onSelect, unavailableDomains = [] }) {
  const groups = new Map();
  for (const capability of capabilities) {
    const key = `${capability.workspace}:${capability.domain}`;
    if (!groups.has(key)) groups.set(key, { workspace: capability.workspace, module: capability.domain_label, rows: [] });
    groups.get(key).rows.push(capability);
  }
  return <div className="space-y-5">{[...groups.entries()].map(([key, group]) => {
    const actions = new Set(group.rows.filter((row) => row.implemented).map((row) => row.capability));
    const unavailable = Object.keys(actionLabels).filter((action) => !actions.has(action)).map((action) => actionLabels[action]);
    const columns = [
      { key: "capability", header: "Capability", render: (row) => <div><div className="font-semibold">{row.label}</div><p className="mt-1 text-xs text-text-secondary">{row.description}</p>{row.requires_human_approval && <p className="mt-1 text-xs text-text-secondary">Human approval required for this action.</p>}</div> },
      { key: "action", header: "Action", render: (row) => actionLabels[row.capability] || "Unavailable" },
      { key: "access", header: "Access", render: (row) => !row.implemented ? <Badge tone="neutral">Unavailable</Badge> : selection ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selection.includes(row.name)} disabled={!row.can_assign || busy} onChange={(event) => onSelect(row.name, event.target.checked)} aria-label={`Allow ${row.label}`} /> Allow</label> : <div className="flex flex-wrap items-center gap-2"><Badge tone={row.granted ? "success" : "neutral"}>{row.granted ? "Allowed" : "Not allowed"}</Badge>{canManage && <button className="btn-secondary" type="button" disabled={busy || !row.can_assign} aria-label={`${row.granted ? "Remove" : "Grant"} ${actionLabels[row.capability]} access to ${row.label}`} onClick={() => onChange(row)}>{row.granted ? "Remove" : "Grant"}</button>}</div> },
    ];
    return <section key={key} aria-label={`${group.workspace} ${group.module} capabilities`}><h3 className="external-agent-heading">{group.workspace} <span className="font-normal text-text-secondary">/ {group.module}</span></h3><DataTable columns={columns} rows={group.rows} getRowKey={(row) => row.name} density="compact" minWidth={520} mobileLayout="stack" /><p className="mt-3 text-xs text-text-secondary">{unavailable.length ? `${unavailable.join(", ")} actions are unavailable in this module.` : "Only the registered actions above are available."}</p></section>;
  })}{unavailableDomains.length > 0 && <p className="external-agent-notice">Factory modules unavailable for agents: {unavailableDomains.join(", ")}.</p>}</div>;
}
