import { useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";

const newStorageLocationTypes = ["Room Temperature", "Chiller", "Freezer"];
export default function StorageLocationModal({ initialValue, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    location_name: "",
    location_code: "",
    location_type: newStorageLocationTypes[0],
    is_storage_location: true,
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.location_name || "").trim()) {
      setError("Location name is required.");
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
      title={initialValue?.id ? "Edit Location" : "Create Location"}
      description="Factory Locations are physical areas. Enable storage only when inventory may be held there."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-storage-location-form" disabled={saving}>{saving ? "Saving..." : initialValue?.id ? "Save Location" : "Create Location"}</button>
        </>
      )}
    >
      <div>
        <form id="factory-storage-location-form" className="space-y-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Location Name *">
              <input className={inputClass()} value={form.location_name || ""} onChange={(event) => setForm((current) => ({ ...current, location_name: event.target.value }))} />
            </Field>
            <Field label="Location Code">
              <input className={inputClass()} value={form.location_code || ""} onChange={(event) => setForm((current) => ({ ...current, location_code: event.target.value }))} />
            </Field>
            <Field label="Location Type">
              <SearchableSelect
                value={form.location_type || ""}
                options={[...new Set([...(initialValue?.location_type ? [initialValue.location_type] : []), ...newStorageLocationTypes])].map((type) => ({ value: type, label: type, helper: !newStorageLocationTypes.includes(type) ? "Legacy type retained for this existing location" : "" }))}
                placeholder="Select Location Type"
                searchPlaceholder="Search location types"
                onChange={(locationType) => setForm((current) => ({ ...current, location_type: locationType }))}
              />
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
          </div>
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-border bg-slate-50 p-3 text-sm font-semibold text-text-primary">
            <input
              className="mt-1"
              type="checkbox"
              checked={form.is_storage_location !== false}
              onChange={(event) => setForm((current) => ({ ...current, is_storage_location: event.target.checked }))}
            />
            <span>
              <span className="block">Storage enabled</span>
              <span className="mt-0.5 block text-xs font-medium text-text-secondary">Inventory, receiving, production output, and stock selectors can use this Location.</span>
            </span>
          </label>
        </form>
      </div>
    </Modal>
  );
}
