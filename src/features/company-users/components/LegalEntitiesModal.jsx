import { useMemo, useState } from "react";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { legalEntityService } from "../../../services/employmentDocumentService.js";
import LegalEntityContractTemplatesModal from "./LegalEntityContractTemplatesModal.jsx";

const emptyEntity = { legal_company_name: "", company_registration_no: "", registered_address: "", display_name: "", is_active: true };

export default function LegalEntitiesModal({ entities, onClose, onChanged, ui }) {
  const [selectedId, setSelectedId] = useState(entities[0]?.id || "new");
  const selected = useMemo(() => entities.find((entity) => entity.id === selectedId), [entities, selectedId]);
  const [draft, setDraft] = useState(() => selected || emptyEntity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [templatesEntity, setTemplatesEntity] = useState(null);
  function choose(entity) { setSelectedId(entity?.id || "new"); setDraft(entity || emptyEntity); setError(""); }
  function patch(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  async function save() {
    setBusy(true); setError("");
    try {
      const saved = await legalEntityService.save(draft);
      await onChanged(saved.id);
      ui?.notify?.({ title: draft.id ? "Legal entity updated." : "Legal entity created." });
      setSelectedId(saved.id); setDraft(saved);
    } catch (cause) { setError(cause.message || "Unable to save legal entity."); }
    finally { setBusy(false); }
  }
  const valid = draft.legal_company_name?.trim() && draft.company_registration_no?.trim() && draft.registered_address?.trim();
  return <><Modal size="lg" title="Legal Entities" description="Maintain the legal employing entities assigned to employees and their contract templates." onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Close</button><button className="btn-primary" type="button" disabled={busy || !valid} onClick={save}>{busy ? "Saving..." : "Save Legal Entity"}</button></>}>
    <div className="grid min-h-[430px] gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4">
        <button className="btn-secondary mb-3 w-full justify-center" type="button" onClick={() => choose(null)}>+ New Legal Entity</button>
        <div className="space-y-1.5">{entities.map((entity) => <button key={entity.id} type="button" onClick={() => choose(entity)} className={`w-full rounded-xl px-3 py-2.5 text-left ${selectedId === entity.id ? "bg-emerald-50 text-emerald-950" : "hover:bg-slate-50"}`}><strong className="block text-sm">{entity.display_name || entity.legal_company_name}</strong><small className="mt-0.5 block text-text-muted">{entity.company_registration_no}{!entity.is_active ? " · Inactive" : ""}</small></button>)}</div>
      </aside>
      <section className="grid content-start gap-4 md:grid-cols-2">
        <AdminFormField label="Legal Company Name" required className="md:col-span-2"><input className="control" value={draft.legal_company_name || ""} onChange={(event) => patch("legal_company_name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Company Registration No." required><input className="control" value={draft.company_registration_no || ""} onChange={(event) => patch("company_registration_no", event.target.value)} /></AdminFormField>
        <AdminFormField label="Display Name" helper="Optional"><input className="control" value={draft.display_name || ""} onChange={(event) => patch("display_name", event.target.value)} /></AdminFormField>
        <AdminFormField label="Registered Address" required className="md:col-span-2"><textarea className="control min-h-28 py-3" value={draft.registered_address || ""} onChange={(event) => patch("registered_address", event.target.value)} /></AdminFormField>
        <label className="md:col-span-2 flex items-center justify-between rounded-xl border border-border px-3 py-3 text-sm font-semibold"><span><strong className="block">Active</strong><small className="font-normal text-text-muted">Inactive entities remain on historical documents but cannot be newly assigned or sent.</small></span><input type="checkbox" checked={draft.is_active !== false} onChange={(event) => patch("is_active", event.target.checked)} /></label>
        {draft.id ? <div className="md:col-span-2 border-t border-border pt-4"><button className="btn-secondary" type="button" onClick={() => setTemplatesEntity(draft)}>Employment Contract Templates</button><p className="mt-1 text-xs text-text-muted">Create and publish the legal-entity-owned template versions used by Create Contract.</p></div> : null}
        {error ? <div className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</div> : null}
      </section>
    </div>
  </Modal>{templatesEntity ? <LegalEntityContractTemplatesModal legalEntity={templatesEntity} ui={ui} onClose={() => setTemplatesEntity(null)} /> : null}</>;
}
