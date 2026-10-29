import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Link2, Plus, RefreshCw } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminUnderlineTabs from "../../components/navigation/AdminUnderlineTabs.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import ConfirmDialog from "../../components/feedback/ConfirmDialog.jsx";
import { formatOperationalMoment } from "../../lib/dateTime.js";
import { externalAgentService } from "../../services/externalAgentService.js";
import { hasPermission } from "../../utils/accessControl.js";
import AgentCapabilities, { actionLabels } from "./AgentCapabilities.jsx";
import "./externalAgents.css";

const labels = { active: "Active", expired: "Expired", revoked: "Revoked", mcp_observed: "Connection seen", not_observed: "Not confirmed", disabled: "Disabled", success: "Completed", failed: "Failed", denied: "Access denied" };
const tone = (state) => ["active", "mcp_observed", "success"].includes(state) ? "success" : ["revoked", "denied", "failed"].includes(state) ? "danger" : state === "expired" ? "warning" : "neutral";
const stamp = (value) => value ? formatOperationalMoment(value) : "Not recorded";
function State({ value }) { return <Badge tone={tone(value)}>{labels[value] || "Not issued"}</Badge>; }
const allowed = (row) => (row.tools || []).filter((tool) => tool.granted && tool.implemented);
function accessSummary(row) {
  if (!row.enabled) return "Disabled";
  if (!row.role_active || !row.permission_granted) return "Access blocked";
  const grants = allowed(row);
  return grants.length ? `${[...new Set(grants.map((tool) => tool.domain_label))].join(", ")} · ${[...new Set(grants.map((tool) => actionLabels[tool.capability]))].join(", ")}` : "No resources allowed";
}
const failureLabels = { credential_denied: "Access key or connection permission was not accepted.", capability_denied: "This capability is not allowed.", tool_denied: "The requested capability is unavailable.", evidence_unavailable: "Information could not be returned. Check access and try again.", origin_denied: "The request came from an unsupported application.", invalid_request: "The request could not be processed.", unsupported_version: "The connection version is unsupported.", method_denied: "This connection request is unsupported." };

const compatibilityActivityLabels = { get_mesti_daily_status: "Daily MeSTI review", list_mesti_exceptions: "MeSTI exceptions reviewed", list_pending_verifications: "Pending verifications reviewed", get_mesti_evidence_details: "MeSTI evidence viewed", get_mesti_requirement_schedule: "MeSTI schedule reviewed" };

export default function ExternalAgentsPage({ auth }) {
  const [data, setData] = useState(null), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [search, setSearch] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview"), [advanced, setAdvanced] = useState(false), [connection, setConnection] = useState(null);
  const [confirmation, setConfirmation] = useState(null), [issued, setIssued] = useState(null), [revealed, setRevealed] = useState(false), [copied, setCopied] = useState(false);
  const [testCredential, setTestCredential] = useState(""), [testResult, setTestResult] = useState(null);
  const selectedRef = useRef(null), generation = useRef(0), alive = useRef(true);
  const canView = hasPermission(auth, "roles.view"), canEdit = hasPermission(auth, "roles.edit"), canCreate = hasPermission(auth, "roles.create");
  const adminId = auth?.user?.id || auth?.profile?.id || null;
  const authority = useRef(null);
  authority.current = canEdit && canView ? adminId || "current-admin" : null;
  useEffect(() => { clearIssued(); setTestCredential(""); setConfirmation(null); setConnection(null); }, [canView, canEdit, adminId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load() {
    setLoading(true); setError("");
    try { const response = await externalAgentService.list(); if (alive.current) setData(response); }
    catch (cause) { if (alive.current) setError(cause.message); }
    finally { if (alive.current) setLoading(false); }
  }
  useEffect(() => { if (canView) load(); else setLoading(false); }, [canView]);
  async function open(row) {
    const version = ++generation.current;
    selectedRef.current = row.id; setSelected(row.id); setDetail(null); setTab("overview"); setAdvanced(false); setTestCredential(""); setTestResult(null); setError("");
    try { const response = await externalAgentService.details(row.id); if (alive.current && generation.current === version) setDetail(response); }
    catch (cause) { if (alive.current && generation.current === version) setError(cause.message); }
  }
  async function refreshDetail() {
    const id = selectedRef.current, version = generation.current;
    const response = await externalAgentService.details(id);
    if (alive.current && id === selectedRef.current && version === generation.current) setDetail(response);
    await load();
  }
  function close() { if (busy) return; ++generation.current; selectedRef.current = null; setSelected(null); setDetail(null); clearIssued(); setTestCredential(""); setTestResult(null); setError(""); }
  function clearIssued() { setIssued(null); setRevealed(false); setCopied(false); }
  useEffect(() => {
    if (!issued) return undefined;
    const clear = () => { if (document.visibilityState === "hidden") clearIssued(); };
    const timer = setTimeout(clearIssued, 120000);
    document.addEventListener("visibilitychange", clear);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", clear); };
  }, [issued]);
  async function manage() {
    const requestedBy = authority.current, action = confirmation;
    setConfirmation(null); setBusy(true); setError(""); clearIssued();
    try {
      if (action.type === "rotate") {
        const result = await externalAgentService.rotate(selected, action.credentialId, crypto.randomUUID());
        if (alive.current && requestedBy && requestedBy === authority.current) setIssued(result);
      } else if (action.type === "enabled") await externalAgentService.setEnabled(selected, !agent.enabled, agent.enabled);
      else if (action.type === "capabilities") await externalAgentService.setCapabilities(selected, action.rows.map((row) => ({ name: row.name, granted: action.granted, expected: row.granted })));
      else if (action.type === "capability") await externalAgentService.setCapability(selected, action.capability.name, !action.capability.granted, action.capability.granted);
      else await externalAgentService.revoke(selected, action.credentialId);
      await refreshDetail();
    } catch (cause) { if (alive.current) setError(cause.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function register(event) {
    event.preventDefault();
    const requestedBy = authority.current;
    setBusy(true); setError(""); clearIssued();
    try {
      const result = await externalAgentService.register(connection.requestId, connection.name.trim(), connection.provider.trim(), connection.adapter, connection.tools);
      if (alive.current && requestedBy && requestedBy === authority.current) { setIssued(result); setConnection(null); }
      await load();
    } catch (cause) { if (alive.current) setError(cause.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setTestResult(null);
    const credential = testCredential.trim(); setTestCredential("");
    try { const result = await externalAgentService.test(selected, credential); if (alive.current) setTestResult(result); await refreshDetail(); }
    catch (cause) { if (alive.current) setError(cause.message); }
    finally { if (alive.current) setBusy(false); }
  }
  const agent = detail?.connections?.[0], permitted = canEdit && agent?.can_manage;
  const rows = (data?.connections || []).filter((row) => `${row.name} ${row.provider} ${row.workspace || ""}`.toLowerCase().includes(search.toLowerCase()));
  const catalog = data?.catalog || [], chosenAdapter = catalog.find((item) => item.key === connection?.adapter);
  const columns = [
    { key: "name", header: "Agent", render: (row) => <button className="external-agent-name" type="button" onClick={() => open(row)}>{row.name}<span>{row.provider}</span></button> },
    { key: "workspace", header: "Workspace", render: (row) => row.workspace || "Not configured" },
    { key: "access", header: "Access", render: (row) => <div>{accessSummary(row)}<div className="mt-1 text-xs text-text-secondary">{allowed(row).length} {allowed(row).length === 1 ? "resource" : "resources"} allowed</div></div> },
    { key: "connection", header: "Connection", render: (row) => <State value={row.connection_status} /> },
    { key: "last_active", header: "Last Active", render: (row) => stamp(row.last_mcp_success) },
    { key: "action", header: "Actions", render: (row) => <button className="btn-secondary" type="button" aria-label={`Manage ${row.name}`} onClick={() => open(row)}>Manage</button> },
  ];
  const activity = [...(detail?.access_events || []).map((event) => ({ ...event, activity: (["query_mesti_resources", "query_factory_resources"].includes(event.tool) ? "Records viewed" : compatibilityActivityLabels[event.tool] || agent?.tools.find((tool) => tool.name === event.tool)?.label) || ({ initialize: "Connection established", "tools/list": "Available capabilities checked", ping: "Connection checked" }[event.method]) || "Unsupported request", sourceLabel: event.source === "admin_probe" ? "FeedX connection check" : "Agent request" })), ...(detail?.management_events || []).map((event) => ({ ...event, activity: event.label, sourceLabel: "Administrator change", outcome: "success" }))].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)).slice(0, 50);
  const activityColumns = [
    { key: "time", header: "When", render: (row) => stamp(row.occurred_at) },
    { key: "activity", header: "Activity", render: (row) => <div>{row.activity}<p className="mt-1 text-xs text-text-secondary">{row.sourceLabel}</p>{row.resource_actions?.length > 0 && <p className="mt-1 text-xs text-text-secondary">{row.resource_actions.map((operation) => `${agent?.tools.find((tool) => tool.resource_key?.endsWith(`.${operation.resource}`))?.resource_label || "Resource"} · ${actionLabels[operation.action]}`).join(", ")}</p>}{row.failure_reason && <p className="mt-1 text-xs text-text-secondary">{failureLabels[row.failure_reason] || "Request unsuccessful. Review agent access and try again."}</p>}</div> },
    { key: "outcome", header: "Result", render: (row) => <State value={row.outcome} /> },
  ];
  if (!canView) return <div className="card p-5" role="alert">Role Settings view permission is required to view external agents.</div>;
  return <div className="external-agents space-y-4">
    <PageHeader title="External Agents" breadcrumbs={[{ label: "Settings" }, { label: "Integrations" }, { label: "External Agents" }]} description="Control what external agents can access and review their activity." actions={<><button className="btn-secondary" type="button" disabled={loading || busy} onClick={load}><RefreshCw size={15} /> Refresh</button>{canCreate && canEdit && data?.can_register && <button className="btn-primary" type="button" disabled={busy || loading || !catalog.length} onClick={() => { setError(""); setConnection({ name: "", provider: "", adapter: catalog[0].key, tools: [], requestId: crypto.randomUUID() }); }}><Plus size={15} /> Connect agent</button>}</>} />
    {!selected && !connection && error && <div role="alert" className="external-agent-notice">{error} <button type="button" className="btn-secondary" onClick={load}>Retry</button></div>}
    <AdminFilterToolbar><AdminSearchField label="Search agents" placeholder="Name, provider or workspace" value={search} onChange={setSearch} /></AdminFilterToolbar>
    <div className="external-agent-surface">{loading ? <p role="status" className="p-5 text-sm text-text-secondary">Loading agents…</p> : rows.length ? <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} density="compact" minWidth={900} mobileLayout="stack" /> : <p className="p-5 text-sm text-text-secondary">{error && !data ? "Agents could not be loaded. Refresh to try again." : search ? "No agents match your search." : "No external agents are connected yet."}</p>}</div>
    <p className="text-xs text-text-secondary">Connection and Last Active reflect recorded successful agent requests, not a continuously live session.</p>
    {selected && <Modal title={agent?.name || "Agent details"} placement="right" onClose={close} panelClassName="external-agent-panel" footer={<button className="btn-secondary" type="button" onClick={close} disabled={busy}>Close</button>}>
      {error && <div role="alert" className="external-agent-notice mb-4">{error}</div>}
      {!agent ? <p role="status">Loading agent details…</p> : <><AdminUnderlineTabs value={tab} onChange={(value) => { setTab(value); setTestCredential(""); }} tabs={[{ value: "overview", label: "Overview" }, { value: "access", label: "Access & Permissions" }, { value: "activity", label: "Activity" }]} ariaLabel="Agent details" />
      <div className="pt-5" role="tabpanel" aria-label={{ overview: "Overview", access: "Access & Permissions", activity: "Activity" }[tab]}>
      {tab === "overview" && <div className="space-y-6"><section><h3 className="external-agent-heading">Agent overview</h3><dl className="external-agent-facts">
        <div><dt>Provider</dt><dd>{agent.provider}</dd></div><div><dt>Workspace</dt><dd>{agent.workspace || "Not configured"}</dd></div>
        <div><dt>Agent access</dt><dd>{agent.enabled ? "Enabled" : "Disabled"}</dd></div><div><dt>Connection</dt><dd><State value={agent.connection_status} /></dd></div>
        <div><dt>Last Active</dt><dd>{stamp(agent.last_mcp_success)}</dd></div><div><dt>Allowed access</dt><dd>{accessSummary(agent)}</dd></div>
      </dl><p className="mt-3 text-xs text-text-secondary">A recorded connection confirms a past successful request. FeedX does not monitor whether the provider is currently connected.</p>
      {permitted && <button className="btn-secondary mt-4" type="button" disabled={busy} onClick={() => setConfirmation({ type: "enabled", title: `${agent.enabled ? "Disable" : "Enable"} agent?`, message: agent.enabled ? `Stop all requests from ${agent.name} immediately. The access key and capability grants are kept so you can enable the agent again.` : `Allow ${agent.name} to use its granted capabilities with a valid access key.`, confirmLabel: agent.enabled ? "Disable agent" : "Enable agent", danger: agent.enabled })}>{agent.enabled ? "Disable agent" : "Enable agent"}</button>}</section>
      <section><h3 className="external-agent-heading">Access key</h3><div className="flex flex-wrap items-center gap-3"><State value={agent.credential?.status} /><span className="text-sm text-text-secondary">{agent.credential ? `Expires ${stamp(agent.credential.expires_at)}` : "No access key issued"}</span></div><p className="mt-3 text-xs text-text-secondary">An active key also requires enabled agent access and granted capabilities. Existing keys cannot be shown again.</p>
      {permitted && <button className="btn-secondary mt-3" type="button" disabled={busy || !agent.role_active || !agent.permission_granted || !!issued} onClick={() => setConfirmation({ type: "rotate", credentialId: agent.credential?.id || null, title: "Replace access key?", message: `Previous keys for ${agent.name} will stop working immediately. Save the new key when it is shown and update the provider to reconnect. The replacement expires after 30 days.`, confirmLabel: "Replace access key", danger: true })}><KeyRound size={15} /> Replace access key</button>}</section>
      <section><h3 className="external-agent-heading">Check connection</h3><p className="mb-3 text-xs text-text-secondary">Check FeedX availability, or add an access key to confirm authentication and granted capabilities. This does not confirm the provider’s own connection.</p><label className="block text-sm font-semibold">Access key <span className="font-normal text-text-secondary">(optional)</span><input className="control mt-1 w-full" type="password" autoComplete="off" spellCheck={false} value={testCredential} disabled={!permitted || busy} onChange={(event) => setTestCredential(event.target.value)} /></label><button className="btn-secondary mt-3" type="button" disabled={!permitted || busy || !agent.endpoint} onClick={test}>{busy ? "Checking…" : testCredential ? "Check access key" : "Check FeedX availability"}</button>{testResult && <p role="status" className="external-agent-notice mt-3">{testResult.message}</p>}</section>
      <section><button type="button" className="btn-secondary" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Advanced Details</button>{advanced && <div className="mt-4 space-y-5"><dl className="external-agent-facts"><div className="external-agent-wide"><dt>Role</dt><dd>{agent.role_name}</dd></div><div className="external-agent-wide"><dt>Connection permission</dt><dd className="external-agent-code">{agent.permission}</dd></div><div><dt>Last request attempt</dt><dd>{stamp(agent.last_access)}</dd></div></dl><section><h4 className="external-agent-heading">MCP connection setup</h4><p className="text-xs text-text-secondary">Streamable HTTP. Set the Authorization header to Bearer followed by the issued access key. Keep keys out of URLs and ordinary chat.</p><div className="external-agent-endpoint mt-3"><Link2 size={15} aria-hidden="true" /><code>{agent.endpoint}</code></div></section><ul className="divide-y divide-border">{agent.tools.map((tool) => <li className="py-2" key={tool.name}><p className="text-sm">{tool.label}</p><p className="external-agent-code text-text-secondary">{tool.resource_key && <>{tool.resource_key} · {actionLabels[tool.capability]}<br /></>}{tool.mcp_tool || tool.name}<br />{tool.permission}</p></li>)}</ul><section><h4 className="external-agent-heading">Access key history</h4><ul className="divide-y divide-border">{(detail.credentials || []).map((credential) => <li key={credential.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><State value={credential.status} /><p className="mt-1 text-xs text-text-secondary">Issued {stamp(credential.created_at)}<br />Expires {stamp(credential.expires_at)}</p></div>{permitted && credential.status !== "revoked" && <button className="btn-secondary" type="button" disabled={busy || !!issued} onClick={() => setConfirmation({ type: "revoke", credentialId: credential.id, title: "Revoke access key?", message: `This key will immediately stop working for ${agent.name}. It cannot be restored. Replace the key to reconnect.`, confirmLabel: "Revoke access key", danger: true })}>Revoke key</button>}</li>)}</ul></section></div>}</section></div>}
      {tab === "access" && <div className="space-y-4"><p className="text-sm text-text-secondary">Choose the records this agent can view. Changes take effect immediately. Selecting a summary also requires its listed source resources.</p>{(!agent.permission_granted || !agent.role_active) && <p className="external-agent-notice">Connection access is blocked by the assigned role. Review the role in Role Settings.</p>}{!agent.can_manage_capabilities && <p className="external-agent-notice">Capability changes require Role Settings edit authority and a dedicated agent role. Manage shared roles in Role Settings.</p>}<AgentCapabilities capabilities={agent.tools} canManage={canEdit && agent.can_manage_capabilities} busy={busy} onChangeMany={(rows, granted) => setConfirmation({type: "capabilities", rows, granted, title: granted ? "Grant module access?" : "Clear module access?", message: `${granted ? "Allow" : "Remove"} View Records for ${rows.length} resources. Related source grants remain separate. This takes effect immediately.`, confirmLabel: granted ? "Grant access" : "Remove access", danger: !granted})} onChange={(capability) => setConfirmation({ type: "capability", capability, title: `${capability.granted ? "Remove" : "Grant"} record access?`, message: `${capability.granted ? "Remove" : "Allow"} ${actionLabels[capability.capability]} access to “${capability.resource_label || capability.label}” for ${agent.name}. This takes effect immediately.`, confirmLabel: capability.granted ? "Remove access" : "Grant access", danger: capability.granted })} /></div>}
      {tab === "activity" && <div className="space-y-4"><p className="text-xs text-text-secondary">Latest 50 recorded events · Malaysia time. Agent requests, FeedX checks and administrator changes are shown separately.</p>{activity.length ? <DataTable columns={activityColumns} rows={activity} getRowKey={(row) => `${row.sourceLabel}:${row.id}`} density="compact" minWidth={580} mobileLayout="stack" /> : <p className="text-sm text-text-secondary">No activity has been recorded yet.</p>}<p className="text-xs text-text-secondary">{detail.history_note}</p><p className="text-xs text-text-secondary">{detail.management_history_note}</p></div>}
      </div></>}
    </Modal>}
    {connection && <Modal title="Connect agent" onClose={() => { if (!busy) { setConnection(null); setError(""); } }} panelClassName="external-agent-panel" footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setConnection(null)}>Cancel</button><button className="btn-primary" type="submit" form="connect-agent" disabled={busy || !connection.tools.length}>Connect and issue key</button></>}>
      <form id="connect-agent" onSubmit={register} className="space-y-4">{error && <p className="external-agent-notice" role="alert">{error}</p>}<p className="text-sm text-text-secondary">Create a dedicated agent role and a 30-day access key. You will see the key once; configure it in the provider’s application.</p><label className="block text-sm font-semibold">Agent name<input className="control mt-1 w-full" required maxLength={120} value={connection.name} disabled={busy} onChange={(event) => setConnection({ ...connection, name: event.target.value })} /></label><label className="block text-sm font-semibold">Provider<input className="control mt-1 w-full" required maxLength={80} placeholder="For example, xAI" value={connection.provider} disabled={busy} onChange={(event) => setConnection({ ...connection, provider: event.target.value })} /></label><SelectField label="Workspace" value={chosenAdapter?.workspace} disabled={busy} options={[...new Set(catalog.map((item) => item.workspace))].map((workspace) => ({ value: workspace, label: workspace }))} onChange={(workspace) => setConnection({ ...connection, adapter: catalog.find((item) => item.workspace === workspace).key, tools: [] })} /><AgentCapabilities capabilities={chosenAdapter?.capabilities || []} selection={connection.tools} busy={busy} onSelectMany={(names, checked) => setConnection({ ...connection, tools: checked ? [...new Set([...connection.tools, ...names])] : connection.tools.filter((name) => !names.includes(name)) })} onSelect={(name, checked) => setConnection({ ...connection, tools: checked ? [...connection.tools, name] : connection.tools.filter((tool) => tool !== name) })} /><p className="text-xs text-text-secondary">Select at least one resource. The agent can use only the access granted here.</p></form>
    </Modal>}
    {issued && <Modal title="Save the access key" description="Shown once. This window clears on close, when the tab is hidden, or after two minutes." onClose={clearIssued} footer={<button className="btn-primary" type="button" onClick={clearIssued}>I have saved the key</button>}><div className="space-y-3"><p className="text-sm text-text-secondary">Expires {stamp(issued.expires_at)}. FeedX cannot retrieve this key again.</p><label className="block text-sm font-semibold">New access key<input className="control mt-1 w-full" type={revealed ? "text" : "password"} readOnly autoComplete="off" value={issued.one_time_credential} /></label><div className="flex flex-wrap gap-2"><button className="btn-secondary" type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff size={15} /> : <Eye size={15} />}{revealed ? "Hide" : "Reveal key"}</button><button className="btn-secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(issued.one_time_credential); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? "Copied" : "Copy key"}</button></div><p className="text-xs text-text-secondary">Save this key securely and configure it in the provider. If it is lost, use Replace access key to issue another.</p></div></Modal>}
    <ConfirmDialog request={confirmation} onCancel={() => setConfirmation(null)} onConfirm={manage} />
  </div>;
}
