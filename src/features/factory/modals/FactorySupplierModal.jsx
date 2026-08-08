import { useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
export default function FactorySupplierModal({ initialValue, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    supplier_name: initialValue?.supplier_name || "",
    supplier_code: initialValue?.supplier_code || "",
    contact_person: initialValue?.contact_person || "",
    phone: initialValue?.phone || "",
    email: initialValue?.email || "",
    status: initialValue?.status || "active",
    remarks: initialValue?.remarks || "",
    id: initialValue?.id,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.supplier_name || "").trim()) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={form.id ? "Edit Supplier" : "Create Supplier"}
      description="Factory suppliers are used by raw material receiving documents."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <div className="flex gap-2">
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-supplier-form" disabled={saving}>{saving ? "Saving..." : form.id ? "Save Supplier" : "Create Supplier"}</button>
        </div>
      )}
    >
      <form id="factory-supplier-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Supplier Details</div>
          </div>
          <Field label="Supplier Name *">
            <input className={inputClass(error && !form.supplier_name)} value={form.supplier_name || ""} onChange={(event) => {
              setError("");
              setForm((current) => ({ ...current, supplier_name: event.target.value }));
            }} />
          </Field>
          <Field label="Supplier Code">
            <input className={inputClass()} value={form.supplier_code || ""} onChange={(event) => setForm((current) => ({ ...current, supplier_code: event.target.value }))} />
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
              emptyText="No status"
              onChange={(value) => setForm((current) => ({ ...current, status: value }))}
            />
          </Field>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Contact Information</div>
          </div>
          <Field label="Contact Person">
            <input className={inputClass()} value={form.contact_person || ""} onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))} />
          </Field>
          <Field label="Phone">
            <input className={inputClass()} value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </Field>
          <Field label="Email">
            <input className={inputClass()} type="email" value={form.email || ""} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          </Field>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Notes</div>
          </div>
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
        </section>
      </form>
    </Modal>
  );
}

