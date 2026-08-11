import { useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";

function focusFirstInvalid(refs, firstKey) { setTimeout(() => { const node = refs.current?.[firstKey]; node?.scrollIntoView?.({ behavior: "smooth", block: "center" }); node?.focus?.({ preventScroll: true }); }, 0); }
export default function ProductGroupModal({ initialValue, categories = [], onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    completion_request_id: crypto.randomUUID(),
    name_en: "",
    name_cn: "",
    name_bm: "",
    is_halal: false,
    category_id: "",
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeCategories = categories.filter((category) => category.status === "active" || category.id === form.category_id);
  const categoryOptions = activeCategories.map((category) => ({ value: category.id, label: category.name, helper: category.description || category.status }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name_en || "").trim()) {
      setError("Finished Good name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!onArchive || !initialValue?.id) return;
    setSaving(true);
    try {
      await onArchive(initialValue);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Finished Good" : "Create Finished Good"}
      description="Finished Goods organize one or more packaging SKUs under one product identity."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          {initialValue?.id && initialValue.status !== "archived" ? <button className="btn-danger" type="button" disabled={saving} onClick={archive}>Archive Finished Good</button> : <span />}
          <div className="flex gap-2">
            {error ? <div className="self-center text-sm font-semibold text-rose-600">{error}</div> : null}
            <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" form="factory-product-group-form" disabled={saving}>{saving ? "Saving..." : "Save Finished Good"}</button>
          </div>
        </>
      )}
    >
      <form id="factory-product-group-form" className="space-y-4" onSubmit={submit}>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Product Identity</div>
            <div className="mt-1 text-sm text-text-secondary">The product master name shared by all packaging SKUs.</div>
          </div>
          <Field label="Product Name (EN) *">
            <input className={inputClass(error)} value={form.name_en || ""} onChange={(event) => {
              setError("");
              setForm((current) => ({ ...current, name_en: event.target.value }));
            }} />
          </Field>
          <Field label="Product Name (CN)">
            <input className={inputClass()} value={form.name_cn || ""} onChange={(event) => setForm((current) => ({ ...current, name_cn: event.target.value }))} />
          </Field>
          <Field label="Product Name (BM)">
            <input className={inputClass()} value={form.name_bm || ""} onChange={(event) => setForm((current) => ({ ...current, name_bm: event.target.value }))} />
          </Field>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Configuration</div>
            <div className="mt-1 text-sm text-text-secondary">Finished Good status and category for warehouse filtering.</div>
          </div>
          <Field label="Category">
            <SearchableSelect
              value={form.category_id || ""}
              options={categoryOptions}
              placeholder="Select Category"
              searchPlaceholder="Search categories"
              emptyText="No categories"
              onChange={(categoryId) => setForm((current) => ({ ...current, category_id: categoryId }))}
            />
          </Field>
          <Field label="Status *">
            <SearchableSelect
              value={form.status || "active"}
              options={[
                { value: "active", label: "Active" },
                { value: "archived", label: "Archived" },
              ]}
              placeholder="Select Status"
              searchPlaceholder="Search status"
              onChange={(status) => setForm((current) => ({ ...current, status }))}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-border bg-white px-3 py-3 text-sm text-text-primary">
            <input className="mt-0.5 h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={Boolean(form.is_halal)} onChange={(event) => setForm((current) => ({ ...current, is_halal: event.target.checked }))} />
            <span><span className="block font-semibold">Halal</span><span className="mt-0.5 block text-xs text-text-secondary">Applies to this Finished Good and all of its Packaging SKUs.</span></span>
          </label>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
        </section>
      </form>
    </Modal>
  );
}

