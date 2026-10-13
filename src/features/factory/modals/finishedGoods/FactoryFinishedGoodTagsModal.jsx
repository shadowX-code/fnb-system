import { useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import TagPicker from "../../../../components/forms/TagPicker.jsx";
import FactoryMasterDataManagerModal from "../../components/FactoryMasterDataManagerModal.jsx";
import FactoryRowActions from "../../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../../components/FactoryStatusBadge.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import { factoryService } from "../../../../services/factoryService.js";

export default function FactoryFinishedGoodTagsModal({ catalog, family, canCreate, canEdit, onClose }) {
  const initialIds = catalog.assignments.filter(a => a.product_family_id === family?.id).map(a => a.tag_id);
  const [names, setNames] = useState(catalog.tags.filter(t => initialIds.includes(t.id)).map(t => t.name));
  const [form, setForm] = useState({ name: "", status: "active" });
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setError(""); setSaving(true);
    try {
      if (family) await factoryService.setProductFamilyTags(family.id, names.map(name => catalog.tags.find(t => t.name === name)?.id));
      else await factoryService.saveFinishedGoodTag(form);
      await catalog.reload();
      if (family) onClose(); else setForm({ name: "", status: "active" });
    } catch (error) { setError(error.message || "Unable to save tags."); }
    finally { setSaving(false); }
  }
  if (family) return <Modal title="Finished Good Tags" description={family.product_group_name || family.name_en} size="md" onClose={saving ? undefined : onClose} footer={<><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" form="factory-family-tags" className="btn-primary" disabled={saving || !canEdit}>{saving ? "Saving…" : "Save Tags"}</button></>}>
    <form id="factory-family-tags" onSubmit={save}>{error ? <p role="alert" className="mb-3 text-sm text-text-secondary">{error}</p> : null}<TagPicker value={names} onChange={setNames} options={catalog.tags.filter(t => t.status === "active").map(t => t.name)} disabled={saving || !canEdit} placeholder="Select Tags" /></form>
  </Modal>;
  return <FactoryMasterDataManagerModal title="Finished Good Tags" description="Descriptive labels shared across each product's Packaging SKUs." size="md" onClose={onClose} saving={saving} editorTitle={form.id ? "Edit tag" : "Create tag"} emptyTitle="No tags" rows={catalog.tags}
    editor={<form className="space-y-3" onSubmit={save}>{error ? <p role="alert" className="text-sm text-text-secondary">{error}</p> : null}<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]"><Field label="Tag"><input aria-label="Tag name" maxLength={60} className={inputClass()} required disabled={saving || (!form.id && !canCreate)} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field><Field label="Status"><select aria-label="Tag status" className={inputClass()} disabled={saving} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}><option value="active">Active</option><option value="archived">Archived</option></select></Field></div><div className="flex gap-2"><button className="btn-primary" disabled={saving || (form.id ? !canEdit : !canCreate)}>{saving ? "Saving…" : form.id ? "Save Changes" : "Create Tag"}</button>{form.id ? <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setForm({ name: "", status: "active" }); setError(""); }}>Cancel</button> : null}</div></form>}
    columns={[{ key: "name", label: "Tag", render: t => t.name }, { key: "usage", label: "Products", render: t => t.usage_count }, { key: "status", label: "Status", render: t => <FactoryStatusBadge status={t.status} /> }, { key: "actions", label: "Actions", render: t => canEdit ? <FactoryRowActions directActions={[{ label: "Edit tag", onClick: () => { setForm(t); setError(""); } }]} secondaryActions={t.status === "active" ? [{ label: "Archive", onClick: () => { setForm({ ...t, status: "archived" }); setError(""); } }] : []} /> : null }]} />;
}
