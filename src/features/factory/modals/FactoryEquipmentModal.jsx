import { useMemo, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FactoryMasterDataManagerModal from "../components/FactoryMasterDataManagerModal.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellMuted, FactoryCellText } from "../components/FactoryTableCell.jsx";

const emptyCategory = () => ({ name: "", category_code: "", status: "active" });

export function FactoryEquipmentCategoryModal({ categories = [], equipment = [], onClose, onSave }) {
  const [draft, setDraft] = useState(emptyCategory);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const usageCounts = useMemo(() => equipment.reduce((counts, item) => {
    if (item.category_id) counts.set(item.category_id, (counts.get(item.category_id) || 0) + 1);
    return counts;
  }, new Map()), [equipment]);

  function resetDraft() {
    setError("");
    setDraft(emptyCategory());
  }

  async function save(nextDraft) {
    setError("");
    setSaving(true);
    try {
      await onSave(nextDraft);
      if (nextDraft.id === draft.id || !nextDraft.id) resetDraft();
    } catch (nextError) {
      setError(nextError.message || "Unable to save Equipment Category.");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!String(draft.name || "").trim()) {
      setError("Equipment category name is required.");
      return;
    }
    await save(draft);
  }

  const columns = [
    { key: "category", label: "Category", render: (category) => <FactoryCellText primary={category.name} secondary={category.category_code || "No code"} /> },
    { key: "code", label: "Code", render: (category) => <span className="font-medium text-text-primary">{category.category_code || <FactoryCellMuted />}</span> },
    { key: "usage", label: "Equipment", align: "right", render: (category) => <span className="font-medium text-text-primary">{usageCounts.get(category.id) || 0}</span> },
    { key: "status", label: "Status", render: (category) => <FactoryStatusBadge status={category.status === "inactive" ? "Inactive" : "Active"} /> },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (category) => <FactoryRowActions
        directSingleSecondary
        secondaryActions={[
          { label: "Edit", onClick: () => { setError(""); setDraft({ id: category.id, name: category.name || "", category_code: category.category_code || "", status: category.status || "active" }); } },
          { label: category.status === "active" ? "Deactivate" : "Reactivate", destructive: category.status === "active", onClick: () => save({ ...category, status: category.status === "active" ? "inactive" : "active" }) },
        ]}
      />,
    },
  ];

  return <FactoryMasterDataManagerModal
    title="Equipment Categories"
    description="Maintain the optional, unique category code used to identify Factory equipment groups."
    editorTitle={draft.id ? "Edit category" : "Create category"}
    editorDescription="Inactive categories remain on existing equipment and cannot be selected for new active setup."
    saving={saving}
    onClose={onClose}
    columns={columns}
    rows={categories}
    emptyTitle="No equipment categories"
    emptyDescription="Create a category before assigning it to Factory equipment."
    editor={<form className="space-y-3" onSubmit={submit}>
      {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_180px]">
        <Field label="Category Name *"><input className={inputClass()} value={draft.name} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
        <Field label="Code"><input className={inputClass()} value={draft.category_code} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, category_code: event.target.value }))} /></Field>
        <Field label="Status"><SearchableSelect value={draft.status} disabled={saving} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} placeholder="Select status" onChange={(status) => setDraft((current) => ({ ...current, status }))} /></Field>
      </div>
      <div className="flex items-center gap-2"><button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : draft.id ? "Save Changes" : "Add Category"}</button>{draft.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={resetDraft}>Cancel</button> : null}</div>
    </form>}
  />;
}

export default function FactoryEquipmentModal({ initialValue, categories = [], locations = [], onClose, onSave }) {
  const [form, setForm] = useState(() => ({ equipment_code: "", name: "", category_id: "", current_location_id: "", status: "active", notes: "", ...initialValue }));
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); if (!form.equipment_code || !form.name || !form.current_location_id) { setError("Code, name and Location are required."); return; } setSaving(true); try { await onSave(form); } finally { setSaving(false); } }
  return <Modal title={initialValue?.id ? "Edit Equipment" : "Create Equipment"} description="Equipment uses the canonical Factory Location and remains traceable after later changes." size="lg" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" form="factory-equipment-form" disabled={saving}>{saving ? "Saving..." : "Save Equipment"}</button></>}><form id="factory-equipment-form" className="space-y-4" onSubmit={submit}>{error ? <div role="alert" className="text-sm font-semibold text-rose-700">{error}</div> : null}<div className="grid gap-3 sm:grid-cols-2"><Field label="Equipment Code *"><input className={inputClass()} value={form.equipment_code} onChange={(e) => setForm((x) => ({ ...x, equipment_code: e.target.value }))} /></Field><Field label="Equipment Name *"><input className={inputClass()} value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} /></Field><Field label="Category"><SearchableSelect value={form.category_id || ""} options={[{ value: "", label: "Uncategorised" }, ...categories.map((x) => ({ value: x.id, label: x.name }))]} onChange={(category_id) => setForm((x) => ({ ...x, category_id }))} /></Field><Field label="Location *"><SearchableSelect value={form.current_location_id || ""} options={locations.filter((x) => x.status === "active" || x.id === form.current_location_id).map((x) => ({ value: x.id, label: x.location_name }))} onChange={(current_location_id) => setForm((x) => ({ ...x, current_location_id }))} /></Field><Field label="Status"><SearchableSelect value={form.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "maintenance", label: "Maintenance" }, { value: "out_of_service", label: "Out of Service" }]} onChange={(status) => setForm((x) => ({ ...x, status }))} /></Field></div><Field label="Notes"><textarea className={inputClass()} rows={3} value={form.notes || ""} onChange={(e) => setForm((x) => ({ ...x, notes: e.target.value }))} /></Field></form></Modal>;
}
