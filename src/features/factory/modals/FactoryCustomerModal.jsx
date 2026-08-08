import { useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";

const factoryCustomerTypes = ["Outlet", "Distributor", "Retailer", "OEM", "Export", "Other"];
export default function FactoryCustomerModal({ initialValue, onClose, onSave }) {
  const emptyForm = { customer_name: "", customer_code: "", customer_type: "Outlet", contact_person: "", phone: "", email: "", address: "", status: "active", remarks: "" };
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    ...initialValue,
    customer_type: initialValue?.customer_type || "Outlet",
    status: initialValue?.status || "active",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = Boolean(initialValue?.id);
  const customerTypeOptions = factoryCustomerTypes.map((option) => ({ value: option, label: option }));
  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
  ];

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.customer_name || "").trim()) {
      setError("Customer name is required.");
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
      title={isEdit ? "Edit Customer" : "Create Customer"}
      description="Maintain customer and destination details used by finished goods dispatch documents."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-customer-form" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Customer" : "Create Customer"}</button>
        </>
      )}
    >
      <form id="factory-customer-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}

        <div className="space-y-3 rounded-2xl border border-border bg-slate-50 p-4">
          <div>
            <div className="font-bold text-text-primary">Customer Details</div>
            <div className="text-sm text-text-secondary">Basic dispatch destination setup.</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Customer Name *">
              <input className={inputClass(error && !form.customer_name)} value={form.customer_name || ""} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} />
            </Field>
            <Field label="Customer Code">
              <input className={inputClass()} value={form.customer_code || ""} onChange={(event) => setForm((current) => ({ ...current, customer_code: event.target.value }))} />
            </Field>
            <Field label="Customer Type *">
              <SearchableSelect
                value={form.customer_type || "Other"}
                options={customerTypeOptions}
                placeholder="Select Customer Type"
                searchPlaceholder="Search customer types"
                emptyText="No customer types"
                onChange={(value) => setForm((current) => ({ ...current, customer_type: value }))}
              />
            </Field>
            <Field label="Status *">
              <SearchableSelect
                value={form.status || "active"}
                options={statusOptions}
                placeholder="Select Status"
                searchPlaceholder="Search status"
                emptyText="No statuses"
                onChange={(value) => setForm((current) => ({ ...current, status: value }))}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
          <div>
            <div className="font-bold text-text-primary">Contact Information</div>
            <div className="text-sm text-text-secondary">Optional contact details for dispatch coordination.</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Contact Person">
              <input className={inputClass()} value={form.contact_person || ""} onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))} />
            </Field>
            <Field label="Phone">
              <input className={inputClass()} value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </Field>
            <Field label="Email">
              <input className={inputClass()} type="email" value={form.email || ""} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </Field>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
          <div className="font-bold text-text-primary">Address</div>
          <Field label="Address">
            <textarea className={inputClass()} rows={2} value={form.address || ""} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          </Field>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
          <div className="font-bold text-text-primary">Notes</div>
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

