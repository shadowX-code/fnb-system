import { useEffect, useMemo, useState } from "react";
import { Edit3, FileText, MoreHorizontal, Plus, Power, Search, Users } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import FilterPopover from "../../../components/forms/FilterPopover.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import { hasPermission } from "../../../utils/accessControl.js";
import { legalEntityService } from "../../../services/legalEntityService.js";
import { legacyHashForRoute, resolveAdminLocation } from "../../../app/routeOwnership.js";
import LegalEntityContractWorkspacePage from "./LegalEntityContractWorkspacePage.jsx";

function emptyEntity() {
  return {
    id: "",
    legal_company_name: "",
    company_registration_no: "",
    registered_address: "",
    display_name: "",
    is_active: true,
    linked_employee_count: 0,
  };
}

function entityName(entity) {
  return entity.display_name || entity.legal_company_name || "Unnamed legal entity";
}

function LegalEntityFormModal({ entity, onClose, onSaved, ui }) {
  const [draft, setDraft] = useState(() => ({ ...emptyEntity(), ...entity }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isNew = !draft.id;
  const valid = draft.legal_company_name.trim() && draft.company_registration_no.trim() && draft.registered_address.trim();
  const linkedEmployees = Number(draft.linked_employee_count || 0);

  function patch(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await legalEntityService.save({
        ...draft,
        legal_company_name: draft.legal_company_name.trim(),
        company_registration_no: draft.company_registration_no.trim(),
        registered_address: draft.registered_address.trim(),
        display_name: draft.display_name.trim(),
      });
      await onSaved(saved);
      ui?.notify?.({ title: isNew ? "Legal entity added" : "Legal entity updated", message: entityName(saved) });
      onClose();
    } catch (cause) {
      setError(cause.message || "Unable to save legal entity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? "Add Legal Entity" : "Edit Legal Entity"}
      description="Legal Entities are the legal employers referenced by employee records and employment documents."
      onClose={onClose}
      size="lg"
      footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={busy || !valid} onClick={save}>{busy ? "Saving..." : "Save Legal Entity"}</button></>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <AdminFormField label="Legal Company Name" required className="md:col-span-2"><input className="control" value={draft.legal_company_name} onChange={(event) => patch("legal_company_name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Company Registration No." required><input className="control" value={draft.company_registration_no} onChange={(event) => patch("company_registration_no", event.target.value)} /></AdminFormField>
        <AdminFormField label="Display Name" helper="Optional"><input className="control" value={draft.display_name} onChange={(event) => patch("display_name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Registered Address" required className="md:col-span-2"><textarea className="control min-h-28 py-3" value={draft.registered_address} onChange={(event) => patch("registered_address", event.target.value)} /></AdminFormField>
        <label className="md:col-span-2 flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3 text-sm">
          <span><strong className="block">Active</strong><small className="mt-1 block text-text-muted">Inactive entities remain linked to existing employees and historical documents, but cannot be newly assigned or used to send a contract.</small></span>
          <input aria-label="Legal entity active" type="checkbox" checked={draft.is_active !== false} onChange={(event) => patch("is_active", event.target.checked)} />
        </label>
        {!isNew && draft.is_active === false && linkedEmployees > 0 ? <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This inactive Legal Entity remains linked to {linkedEmployees} employee{linkedEmployees === 1 ? "" : "s"}; those historical relationships are preserved.</div> : null}
        {error ? <div className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}
      </div>
    </Modal>
  );
}

function DeactivateModal({ entity, onClose, onConfirm, busy }) {
  const linkedEmployees = Number(entity.linked_employee_count || 0);
  return <Modal title="Deactivate Legal Entity" description="This changes availability for future employment assignments; it does not remove historical links." onClose={onClose} size="md" footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-danger" type="button" disabled={busy} onClick={onConfirm}>{busy ? "Deactivating..." : "Deactivate"}</button></>}>
    <div className="space-y-3 text-sm text-text-secondary"><p><strong className="text-text-primary">{entityName(entity)}</strong> will be unavailable when assigning a Legal Employer to a new or edited employee and when sending a new employment document.</p><p>{linkedEmployees ? `${linkedEmployees} existing employee${linkedEmployees === 1 ? " remains" : "s remain"} linked. Their relationships and all issued-document snapshots are preserved.` : "There are no linked employees."}</p></div>
  </Modal>;
}

export default function LegalEntitiesPage({ ui, auth }) {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [formEntity, setFormEntity] = useState(null);
  const [deactivateEntity, setDeactivateEntity] = useState(null);
  const [actionMenuEntityId, setActionMenuEntityId] = useState(null);
  const [contractWorkspaceEntityId, setContractWorkspaceEntityId] = useState(() => contractWorkspaceIdFromHash());
  const [busy, setBusy] = useState(false);
  const canView = hasPermission(auth, "legal_entities.view");
  const canManage = hasPermission(auth, "legal_entities.manage");

  async function loadEntities() {
    setLoading(true);
    setError("");
    try {
      setEntities(await legalEntityService.list());
    } catch (cause) {
      setError(cause.message || "Unable to load Legal Entities.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (canView) loadEntities(); else { setLoading(false); setEntities([]); } }, [canView]);
  useEffect(() => {
    const syncContractWorkspace = () => setContractWorkspaceEntityId(contractWorkspaceIdFromHash());
    window.addEventListener("hashchange", syncContractWorkspace);
    window.addEventListener("popstate", syncContractWorkspace);
    return () => {
      window.removeEventListener("hashchange", syncContractWorkspace);
      window.removeEventListener("popstate", syncContractWorkspace);
    };
  }, []);

  const filteredEntities = useMemo(() => {
    const search = query.trim().toLowerCase();
    return entities.filter((entity) => {
      const matchesSearch = !search || [entity.legal_company_name, entity.display_name, entity.company_registration_no].some((value) => String(value || "").toLowerCase().includes(search));
      return matchesSearch && (status === "all" || (status === "active" ? entity.is_active : !entity.is_active));
    });
  }, [entities, query, status]);

  async function persistEntity(nextEntity) {
    const saved = await legalEntityService.save(nextEntity);
    setEntities((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [saved, ...current]);
    return saved;
  }

  async function deactivate() {
    if (!deactivateEntity) return;
    setBusy(true);
    try {
      await persistEntity({ ...deactivateEntity, is_active: false });
      ui?.notify?.({ title: "Legal entity deactivated", message: entityName(deactivateEntity) });
      setDeactivateEntity(null);
    } catch (cause) {
      ui?.notify?.({ title: "Unable to deactivate Legal Entity", message: cause.message || "Please try again.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: "name", header: "Legal Entity", sticky: true, width: "35%", render: (row) => <div><div className="text-sm font-bold text-text-primary">{entityName(row)}</div>{row.display_name ? <div className="mt-0.5 text-xs text-text-secondary">{row.legal_company_name}</div> : null}</div> },
    { key: "registration", header: "Registration / Company ID", width: "24%", render: (row) => <span className="font-medium text-text-primary">{row.company_registration_no}</span> },
    { key: "status", header: "Status", width: "14%", render: (row) => <Badge tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Inactive"}</Badge> },
    { key: "employees", header: "Employees linked", width: "16%", render: (row) => <span className="inline-flex items-center gap-1.5 font-semibold text-text-primary"><Users size={15} className="text-text-muted" />{Number(row.linked_employee_count || 0)}</span> },
    { key: "actions", header: "Actions", align: "right", width: "72px", render: (row) => canManage ? <div onClick={(event) => event.stopPropagation()}><ActionMenu open={actionMenuEntityId === row.id} onOpenChange={(open) => setActionMenuEntityId(open ? row.id : null)} align="right" ariaLabel={`Actions for ${entityName(row)}`} trigger={({ toggle, ariaLabel }) => <button className="icon-btn" type="button" aria-label={ariaLabel} onClick={toggle}><MoreHorizontal size={17} /></button>}><button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { setFormEntity(row); setActionMenuEntityId(null); }}><Edit3 size={14} /> Edit</button><button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { window.location.hash = legacyHashForRoute("legal-entities-contract-templates", { legalEntityId: row.id }); setActionMenuEntityId(null); }}><FileText size={14} /> Contract Templates</button><div className="my-1 border-t border-border" />{row.is_active ? <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50" type="button" onClick={() => { setDeactivateEntity(row); setActionMenuEntityId(null); }}><Power size={14} /> Deactivate</button> : <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-emerald-800 hover:bg-emerald-50" type="button" onClick={() => { setFormEntity({ ...row, is_active: true }); setActionMenuEntityId(null); }}><Power size={14} /> Activate</button>}</ActionMenu></div> : <span className="text-text-muted">—</span> },
  ];

  if (contractWorkspaceEntityId) {
    return <LegalEntityContractWorkspacePage
      legalEntity={entities.find((entity) => entity.id === contractWorkspaceEntityId) || null}
      loading={loading}
      auth={auth}
      ui={ui}
      onBack={() => { window.location.hash = legacyHashForRoute("legal-entities"); }}
    />;
  }

  return <div className="space-y-4">
    <PageHeader section="People" title="Legal Entities" description="Manage employing entities used across employee records." actions={canManage ? <button className="btn-primary" type="button" onClick={() => setFormEntity(emptyEntity())}><Plus size={16} /> Add Legal Entity</button> : null} />
    {!canManage ? <div className="rounded-xl border border-border bg-slate-50 px-4 py-3 text-sm text-text-secondary">Read-only access. You need Legal Entities manage permission to add, edit, activate or deactivate records.</div> : null}
    <FilterBar compact><FieldLabel label="Search"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} /><input className="control h-9 min-w-[260px] pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entity or registration number" /></div></FieldLabel><FieldLabel label="Status"><FilterPopover value={status === "all" ? "" : status} placeholder="All statuses" options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onApply={(value) => setStatus(value || "all")} /></FieldLabel></FilterBar>
    <Card>{loading ? <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading Legal Entities...</div> : error ? <div className="p-8 text-center text-sm font-semibold text-rose-700">{error}</div> : filteredEntities.length ? <DataTable columns={columns} rows={filteredEntities} getRowKey={(row) => row.id} density="compact" tableClassName="min-w-[980px]" onRowClick={canManage ? (row) => setFormEntity(row) : undefined} /> : <div className="p-8 text-center"><div className="text-sm font-bold text-text-primary">No Legal Entities found.</div><p className="mt-1 text-sm text-text-secondary">Add a legal employer before assigning one to an employee.</p></div>}</Card>
    {formEntity ? <LegalEntityFormModal entity={formEntity} ui={ui} onClose={() => setFormEntity(null)} onSaved={async (saved) => { const latest = await legalEntityService.list(); setEntities(latest); return saved; }} /> : null}
    {deactivateEntity ? <DeactivateModal entity={deactivateEntity} busy={busy} onClose={() => setDeactivateEntity(null)} onConfirm={deactivate} /> : null}
  </div>;
}

function contractWorkspaceIdFromHash() {
  const route = resolveAdminLocation(window.location);
  return route?.definitionId === "legal-entities-contract-templates" ? route.params.legalEntityId : null;
}
