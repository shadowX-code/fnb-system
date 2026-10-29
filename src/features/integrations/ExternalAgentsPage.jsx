import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import ConfirmDialog from "../../components/feedback/ConfirmDialog.jsx";
import { formatOperationalMoment } from "../../lib/dateTime.js";
import { externalAgentService } from "../../services/externalAgentService.js";
import { hasPermission } from "../../utils/accessControl.js";
import "./externalAgents.css";

const labels = { active: "Active", expired: "Expired", revoked: "Revoked", mcp_observed: "MCP observed", not_observed: "Not observed", disabled: "Disabled", success: "Success", failed: "Failed", denied: "Denied" };
const tone = (state) => state === "active" || state === "mcp_observed" || state === "success" ? "success" : state === "revoked" || state === "denied" || state === "failed" ? "danger" : state === "expired" ? "warning" : "neutral";
const stamp = (value) => value ? formatOperationalMoment(value) : "Not recorded";
function State({ value }) { return <Badge tone={tone(value)}>{labels[value] || value || "Not issued"}</Badge>; }

export default function ExternalAgentsPage({ auth }) {
  const [data, setData] = useState(null), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [search, setSearch] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [confirmation, setConfirmation] = useState(null), [issued, setIssued] = useState(null), [revealed, setRevealed] = useState(false), [copied, setCopied] = useState(false);
  const [testCredential, setTestCredential] = useState(""), [testResult, setTestResult] = useState(null);
  const selectedRef = useRef(null), generation = useRef(0), alive = useRef(true);
  const canView = hasPermission(auth, "roles.view");
  const canEdit = hasPermission(auth, "roles.edit");
  const authority = useRef(null);
  authority.current = canEdit && canView ? auth?.user?.id || auth?.profile?.id || "current-admin" : null;
  useEffect(() => { if (!canView || !canEdit) { clearIssued(); setTestCredential(""); setConfirmation(null); } }, [canView, canEdit]);
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
    selectedRef.current = row.id; setSelected(row.id); setDetail(null); setTestCredential(""); setTestResult(null); setError("");
    try { const response = await externalAgentService.details(row.id); if (alive.current && generation.current === version) setDetail(response); }
    catch (cause) { if (alive.current && generation.current === version) setError(cause.message); }
  }
  async function refreshDetail() {
    const id = selectedRef.current, version = generation.current;
    const response = await externalAgentService.details(id);
    if (alive.current && id === selectedRef.current && version === generation.current) setDetail(response);
    await load();
  }
  function close() { if (busy) return; ++generation.current; selectedRef.current = null; setSelected(null); setDetail(null); setIssued(null); setRevealed(false); setCopied(false); setTestCredential(""); setTestResult(null); setError(""); }
  function clearIssued() { setIssued(null); setRevealed(false); setCopied(false); }
  useEffect(() => {
    if (!issued) return undefined;
    const clear = () => { if (document.visibilityState === "hidden") clearIssued(); };
    const timer = setTimeout(clearIssued, 120000);
    document.addEventListener("visibilitychange", clear);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", clear); };
  }, [issued]);
  async function manage() {
    const requestedBy = authority.current;
    const action = confirmation; setConfirmation(null); setBusy(true); setError(""); clearIssued();
    try {
      if (action.type === "rotate") {
        const result = await externalAgentService.rotate(selected, action.credentialId, crypto.randomUUID());
        if (alive.current && requestedBy && requestedBy === authority.current) { setIssued(result); setRevealed(false); }
      } else await externalAgentService.revoke(selected, action.credentialId);
      await refreshDetail();
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
  const agent = detail?.connections?.[0];
  const permitted = canEdit && agent?.can_manage;
  const rows = (data?.connections || []).filter((row) => `${row.name} ${row.provider} ${row.workspace || ""}`.toLowerCase().includes(search.toLowerCase()));
  const columns = [
    { key: "name", header: "Agent", render: (row) => <button className="external-agent-name" type="button" onClick={() => open(row)}>{row.name}<span>{row.provider}</span></button> },
    { key: "scope", header: "Workspace / scope", render: (row) => <div><div className="font-semibold">{row.workspace || "Not configured"}</div><div className="text-xs text-text-secondary">{row.scope || "No adapter registered"}</div></div> },
    { key: "permission", header: "Permission", render: (row) => <div><span className="external-agent-code">{row.permission || "Not assigned"}</span>{!row.permission_granted && <div className="text-xs text-text-secondary">Permission not granted</div>}</div> },
    { key: "credential", header: "Credential", render: (row) => <div><State value={row.credential?.status} /><div className="mt-1 text-xs text-text-secondary">{row.credential ? `Expires ${stamp(row.credential.expires_at)}` : "No credential issued"}</div></div> },
    { key: "connection", header: "MCP connection", render: (row) => <div><State value={row.connection_status} /><div className="mt-1 text-xs text-text-secondary">Last access: {stamp(row.last_access)}</div></div> },
    { key: "action", header: "", render: (row) => <button className="icon-btn" type="button" aria-label={`View ${row.name}`} onClick={() => open(row)}><Eye size={16} /></button> },
  ];
  if (!canView) return <div className="card p-5" role="alert">Role Settings view permission is required to view external agents.</div>;
  return <div className="external-agents space-y-4">
    <PageHeader title="External Agents" breadcrumbs={[{ label: "Settings" }, { label: "Integrations" }, { label: "External Agents" }]} description="Manage registered agent connections, credentials and observed access through the FeedX External Agent Gateway." actions={<button className="btn-secondary" type="button" disabled={loading || busy} onClick={load}><RefreshCw size={15} /> Refresh</button>} />
    <div className="border-b border-border pb-2 text-sm font-semibold text-text-primary">External Agents</div>
    {!selected && error && <div role="alert" className="external-agent-notice">{error} <button type="button" className="btn-secondary" onClick={load}>Retry</button></div>}
    <AdminFilterToolbar><AdminSearchField label="Search agents" placeholder="Name, provider or workspace" value={search} onChange={setSearch} /></AdminFilterToolbar>
    <p className="text-xs text-text-secondary">An Active credential is within its validity period; the agent and its role must also permit access. MCP observed means a successful external MCP request was recorded, not a continuously live session or verified provider setup.</p>
    <div className="external-agent-surface">
      {loading ? <p role="status" className="p-5 text-sm text-text-secondary">Loading connections…</p> : rows.length ? <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} density="compact" minWidth={1000} mobileLayout="cards" /> : <p className="p-5 text-sm text-text-secondary">{error && !data ? "Connections unavailable. Retry to load registered agents." : search ? "No agents match your search." : "No external agents have been registered."}</p>}
    </div>
    <p className="text-xs text-text-secondary">{data?.history_note}</p>
    {selected && <Modal title={agent?.name || "Agent connection"} description="External Agent Gateway" placement="right" onClose={close} panelClassName="external-agent-panel" footer={<button className="btn-secondary" type="button" onClick={close} disabled={busy}>Close</button>}>
      {error && <div role="alert" className="external-agent-notice mb-4">{error}</div>}
      {!agent ? <p role="status">Loading connection details…</p> : <div className="space-y-6">
        <section aria-label="Connection overview"><h3 className="external-agent-heading">Connection</h3><dl className="external-agent-facts">
          <div><dt>Provider</dt><dd>{agent.provider}</dd></div><div><dt>Workspace</dt><dd>{agent.workspace || "Not configured"}</dd></div>
          <div><dt>Credential</dt><dd><State value={agent.credential?.status} /></dd></div><div><dt>MCP connection</dt><dd><State value={agent.connection_status} /></dd></div>
          <div><dt>Last access</dt><dd>{stamp(agent.last_access)}</dd></div><div><dt>Last successful external MCP</dt><dd>{stamp(agent.last_mcp_success)}</dd></div>
          <div className="external-agent-wide"><dt>Scope</dt><dd>{agent.scope || "No scope configured"}</dd></div><div className="external-agent-wide"><dt>Role / permission</dt><dd>{agent.role_name}<br /><span className="external-agent-code">{agent.permission || "Not assigned"}</span></dd></div>
        </dl>{!agent.permission_granted && <p className="external-agent-notice">The adapter permission is not granted. Update the agent’s role through Role Settings.</p>}</section>
        <section><h3 className="external-agent-heading">Authorized tools <span className="text-text-secondary">({agent.tools.length})</span></h3><ul className="divide-y divide-border">{agent.tools.map((tool) => <li key={tool.name} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="external-agent-code">{tool.name}</span><Badge tone="neutral">{tool.capability === "read" ? "Read only" : tool.capability || "Not specified"}</Badge></div><p className="mt-1 text-xs text-text-secondary">{tool.description}</p><p className="mt-1 text-xs text-text-muted">{agent.workspace} · {tool.domain === "mesti" ? "MeSTI" : tool.domain} · {tool.requires_human_approval ? "Human approval required" : "No human approval required for this read"}</p></li>)}</ul></section>
        <section><h3 className="external-agent-heading">Connect with MCP</h3><p className="text-sm text-text-secondary">Use Streamable HTTP and an Authorization header: Bearer followed by the issued credential. Keep credentials out of URLs and ordinary chat.</p><div className="external-agent-endpoint mt-3"><Link2 size={15} aria-hidden="true" /><code>{agent.endpoint || "Endpoint unavailable"}</code></div><p className="mt-2 text-xs text-text-secondary">FeedX manages access only. Configure the provider’s prompts, knowledge and routines in that provider.</p></section>
        <section><h3 className="external-agent-heading">Test connection</h3><p className="mb-3 text-xs text-text-secondary">Leave the credential blank to check public reachability. Supply a credential to test authentication and tool discovery. FeedX tests are labelled separately from external access.</p><label className="block text-sm font-semibold">Agent credential <span className="font-normal text-text-secondary">(optional)</span><input className="control mt-1 w-full" type="password" autoComplete="off" spellCheck={false} value={testCredential} disabled={!permitted || busy} onChange={(event) => setTestCredential(event.target.value)} /></label><button className="btn-secondary mt-3" type="button" disabled={!permitted || busy || !agent.endpoint} onClick={test}>{busy ? "Working…" : testCredential ? "Test supplied credential" : "Test endpoint"}</button>{testResult && <p role="status" className="external-agent-notice mt-3">{testResult.message}</p>}</section>
        <section><h3 className="external-agent-heading">Credentials</h3><p className="mb-3 text-xs text-text-secondary">Rotation immediately revokes previous credentials and issues a new 30-day credential. Stored credentials cannot be revealed.</p>{permitted && <button className="btn-secondary mb-3" type="button" disabled={busy || !agent.enabled || !agent.role_active || !agent.permission_granted || !!issued} onClick={() => setConfirmation({ type: "rotate", credentialId: agent.credential?.id || null, title: "Rotate agent credential?", message: `This immediately revokes all previous credentials for ${agent.name}. The external agent will stop authenticating until you configure the new credential. It will be available only in the next secure reveal.`, confirmLabel: "Rotate credential", danger: true })}><KeyRound size={15} /> Rotate credential</button>}
          {!permitted && <p className="text-xs text-text-secondary">Credential actions require Role Settings edit authority for this agent.</p>}
          <ul className="divide-y divide-border">{(detail.credentials || []).map((credential) => <li key={credential.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><State value={credential.status} /><div className="mt-1 text-xs text-text-secondary">Issued {stamp(credential.created_at)}<br />Expires {stamp(credential.expires_at)}</div></div>{permitted && credential.status !== "revoked" && <button className="btn-secondary" type="button" disabled={busy || !!issued} onClick={() => setConfirmation({ type: "revoke", credentialId: credential.id, title: "Revoke agent credential?", message: `This credential will immediately stop authenticating ${agent.name}. Revocation cannot be undone.`, confirmLabel: "Revoke credential", danger: true })}>Revoke</button>}</li>)}</ul>
        </section>
        <section><h3 className="external-agent-heading">Recent access</h3><p className="mb-2 text-xs text-text-secondary">Malaysia time · latest 50 events. {detail.history_note}</p>{!detail.access_events?.length ? <p className="text-sm text-text-secondary">No access events recorded yet.</p> : <ul className="divide-y divide-border">{detail.access_events.map((event) => <li key={event.id} className="py-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><span>{stamp(event.occurred_at)}</span><State value={event.outcome} /></div><div className="external-agent-code mt-1">{event.tool || event.method}</div><p className="mt-1 text-xs text-text-secondary">{event.source === "admin_probe" ? "FeedX connection test" : "External MCP request"}{event.failure_reason ? ` · ${event.failure_reason.replaceAll("_", " ")}` : ""}</p></li>)}</ul>}</section>
      </div>}
    </Modal>}
    {issued && <Modal title="Save the new credential" description="Available only in this issuance window. It is cleared when this window closes, the tab is hidden, or after two minutes." onClose={clearIssued} footer={<button className="btn-primary" type="button" onClick={clearIssued}>I have saved the credential</button>}>
      <div className="space-y-3"><p className="text-sm text-text-secondary">Expires {stamp(issued.expires_at)}. FeedX stores only its verification hash and cannot retrieve this credential again.</p><label className="block text-sm font-semibold">New agent credential<input className="control mt-1 w-full" type={revealed ? "text" : "password"} readOnly autoComplete="off" value={issued.one_time_credential} /></label><div className="flex flex-wrap gap-2"><button className="btn-secondary" type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff size={15} /> : <Eye size={15} />}{revealed ? "Hide" : "Reveal credential"}</button><button className="btn-secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(issued.one_time_credential); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? "Copied" : "Copy credential"}</button></div><p className="text-xs text-text-secondary">If this issuance response is lost, refresh the connection and explicitly rotate again. No secret is saved in browser storage.</p></div>
    </Modal>}
    <ConfirmDialog request={confirmation} onCancel={() => setConfirmation(null)} onConfirm={manage} />
  </div>;
}
