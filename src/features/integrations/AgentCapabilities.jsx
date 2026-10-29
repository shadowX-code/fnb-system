import DataTable from "../../components/tables/DataTable.jsx";
import Badge from "../../components/ui/Badge.jsx";

export const actionLabels = { list: "List", read: "Read", search: "Search", filter: "Filter", draft: "Draft", execute: "Execute", approve: "Approve" };
export default function AgentCapabilities({ capabilities = [], canManage = false, busy = false, onChange, selection, onSelect, unavailableDomains = [] }) {
  const groups = new Map();
  for (const capability of capabilities) {
    const key = `${capability.workspace}:${capability.domain}`;
    if (!groups.has(key)) groups.set(key, { workspace: capability.workspace, module: capability.domain_label, rows: [] });
    groups.get(key).rows.push(capability);
  }
  const accessCell = (row, resourceLabel = row?.label || "Resource") => !row?.implemented ? <Badge tone="neutral">Unavailable</Badge> : selection ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selection.includes(row.name)} disabled={!row.can_assign || busy} onChange={(event) => onSelect(row.name, event.target.checked)} aria-label={`Allow ${resourceLabel} ${actionLabels[row.capability]}`} /> Allow</label> : <div className="flex flex-wrap items-center gap-2"><Badge tone={row.granted ? "success" : "neutral"}>{row.granted ? "Allowed" : "Not allowed"}</Badge>{canManage && <button className="btn-secondary" type="button" disabled={busy || !row.can_assign} aria-label={`${row.granted ? "Remove" : "Grant"} ${actionLabels[row.capability]} access to ${resourceLabel}`} onClick={() => onChange(row)}>{row.granted ? "Remove" : "Grant"}</button>}</div>;
  return <div className="space-y-5">{[...groups.entries()].map(([key, group]) => {
    const actions = new Set(group.rows.filter((row) => row.implemented).map((row) => row.capability));
    const unavailable = Object.keys(actionLabels).filter((action) => !actions.has(action)).map((action) => actionLabels[action]);
    const legacyRows = group.rows.filter((row) => !row.resource_key);
    const resourceRows = new Map();
    for (const capability of group.rows.filter((row) => row.resource_key)) {
      if (!resourceRows.has(capability.resource_key)) resourceRows.set(capability.resource_key, { key: capability.resource_key, label: capability.resource_label, description: capability.resource_description, actions: {} });
      resourceRows.get(capability.resource_key).actions[capability.capability] = capability;
    }
    const resourceActions = Object.keys(actionLabels).filter((action) => group.rows.some((row) => row.resource_key && row.capability === action && row.implemented));
    const resourceColumns = [{ key: "resource", header: "Resource", render: (row) => <div><div className="font-semibold">{row.label}</div><p className="mt-1 text-xs text-text-secondary">{row.description}</p></div> }, ...resourceActions.map((action) => ({ key: action, header: actionLabels[action], render: (row) => accessCell(row.actions[action], row.label) }))];
    const columns = [
      { key: "capability", header: "Capability", render: (row) => <div><div className="font-semibold">{row.label}</div><p className="mt-1 text-xs text-text-secondary">{row.description}</p>{row.requires_human_approval && <p className="mt-1 text-xs text-text-secondary">Human approval required for this action.</p>}</div> },
      { key: "action", header: "Action", render: (row) => actionLabels[row.capability] || "Unavailable" },
      { key: "access", header: "Access", render: (row) => !row.implemented ? <Badge tone="neutral">Unavailable</Badge> : selection ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selection.includes(row.name)} disabled={!row.can_assign || busy} onChange={(event) => onSelect(row.name, event.target.checked)} aria-label={`Allow ${row.label}`} /> Allow</label> : <div className="flex flex-wrap items-center gap-2"><Badge tone={row.granted ? "success" : "neutral"}>{row.granted ? "Allowed" : "Not allowed"}</Badge>{canManage && <button className="btn-secondary" type="button" disabled={busy || !row.can_assign} aria-label={`${row.granted ? "Remove" : "Grant"} ${actionLabels[row.capability]} access to ${row.label}`} onClick={() => onChange(row)}>{row.granted ? "Remove" : "Grant"}</button>}</div> },
    ];
    return <section key={key} aria-label={`${group.workspace} ${group.module} capabilities`}><h3 className="external-agent-heading">{group.workspace} <span className="font-normal text-text-secondary">/ {group.module}</span></h3>{resourceRows.size > 0 && <div className="space-y-3"><p className="text-xs text-text-secondary">Resource actions are granted separately. Existing review-tool access does not grant resource access.</p><DataTable columns={resourceColumns} rows={[...resourceRows.values()]} getRowKey={(row) => row.key} density="compact" minWidth={680} mobileLayout="stack" /></div>}{legacyRows.length > 0 && <details open={!resourceRows.size} className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Legacy review tools · {legacyRows.filter((row) => row.granted).length} allowed</summary><div className="mt-3"><DataTable columns={columns} rows={legacyRows} getRowKey={(row) => row.name} density="compact" minWidth={520} mobileLayout="stack" /></div></details>}<p className="mt-3 text-xs text-text-secondary">{unavailable.length ? `${unavailable.join(", ")} actions are unavailable in this module.` : "Only the registered actions above are available."}</p></section>;
  })}{unavailableDomains.length > 0 && <p className="external-agent-notice">Factory domains unavailable for agents: {unavailableDomains.join(", ")}.</p>}</div>;
}
