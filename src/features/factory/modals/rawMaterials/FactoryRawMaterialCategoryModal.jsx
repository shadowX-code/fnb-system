import { useRef, useState } from "react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
export default function RawMaterialCategoryModal({ categories, canEdit = false, onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    name: "",
    description: "",
    status: "active",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name || "").trim()) {
      setError("Category name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm({ name: "", description: "", status: "active" });
    } finally {
      setSaving(false);
    }
  }

  function edit(category) {
    setForm({ id: category.id, name: category.name || "", description: category.description || "", status: category.status || "active" });
    setError("");
  }

  async function archive(category) {
    setSaving(true);
    try {
      await onArchive(category);
      if (form.id === category.id) setForm({ name: "", description: "", status: "active" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Raw Material Categories"
      description="Group raw material master records for warehouse visibility and setup."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <form id="factory-raw-material-category-form" className="space-y-4 rounded-xl border border-border bg-slate-50 p-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <Field label="Category Name">
            <input className={inputClass()} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea className={inputClass()} rows={3} value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </Field>
          <Field label="Status">
            <SearchableSelect
              value={form.status}
              options={[
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
              placeholder="Select Status"
              searchPlaceholder="Search status"
              onChange={(status) => setForm((current) => ({ ...current, status }))}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Category" : "Create Category"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={() => setForm({ name: "", description: "", status: "active" })}>New</button> : null}
          </div>
        </form>
        <div className="max-h-[460px] overflow-y-auto rounded-xl border border-border bg-white">
          {categories.length ? categories.map((category) => (
            <div key={category.id} className="flex items-start justify-between gap-3 border-b border-border p-4 last:border-0">
              <div>
                <div className="font-bold text-text-primary">{category.name}</div>
                <div className="mt-1 text-sm text-text-secondary">{category.description || "No description"}</div>
                <div className="mt-2"><Badge tone={category.status === "active" ? "success" : "neutral"}>{category.status}</Badge></div>
              </div>
              <div className="flex shrink-0 gap-2">
                {canEdit ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => edit(category)}>Edit</button> : null}
                {canEdit && onArchive && category.status !== "archived" ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => archive(category)}>Archive</button> : null}
              </div>
            </div>
          )) : <EmptyState title="No categories" description="Create a category before saving raw material master records." />}
        </div>
      </div>
    </Modal>
  );
}
