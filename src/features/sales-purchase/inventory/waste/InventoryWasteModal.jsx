import { useState } from "react";
import { Upload } from "lucide-react";
import Modal from "../../../../components/feedback/Modal.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../../components/forms/DatePickerField.jsx";
import { IMAGE_UPLOAD_ACCEPT, optimizeImageFileForPreview } from "../../../../utils/imageUpload.js";

const wasteTypes = ["Spoilage", "Expired", "Kitchen Error", "Burnt", "Returned Item", "Staff Consumption", "Unknown"];

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">{label}</div>
      <input className="control h-9 w-full text-[13px]" type={type} min={type === "number" ? 0 : undefined} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">{label}</div>
      <textarea className="control min-h-20 w-full resize-none text-[13px]" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default function InventoryWasteModal({ outlet, items, todayInput, parseNonNegativeNumber, onClose, onSave }) {
  const [form, setForm] = useState({
    id: "",
    date: todayInput(),
    itemId: items[0]?.id ?? "",
    outletId: outlet?.id ?? "",
    wasteType: "Spoilage",
    quantity: "",
    photoUrl: "",
    photoFile: null,
    notes: "",
  });
  const [photoError, setPhotoError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedItem = items.find((item) => item.id === form.itemId);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function handlePhoto(file) {
    setPhotoError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      setForm((current) => ({ ...current, photoUrl: optimized.dataUrl, photoFile: file }));
    } catch (error) {
      setPhotoError(error.message || "Unable to read image.");
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave({ ...form, unit: selectedItem?.unit || selectedItem?.uom_code || "" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal title="Record Waste" description={`${outlet?.name || "Selected outlet"} · Track spoilage, expiry, kitchen error and unexplained leakage.`} onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={isSaving || !form.itemId || !form.outletId || Number(form.quantity) <= 0} onClick={handleSave}>{isSaving ? "Saving..." : "Save Waste"}</button></>}>
      <div className="grid gap-3">
        <div className="rounded-2xl border border-border bg-slate-50 p-3"><div className="type-caption font-semibold text-text-secondary">Outlet</div><div className="mt-1 type-body-sm font-bold text-text-primary">{outlet?.name || "Selected outlet"}</div></div>
        <SelectField label="Item" value={form.itemId} options={items.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => update("itemId", value)} searchable />
        <SelectField label="Waste Type" value={form.wasteType} options={wasteTypes.map((type) => ({ value: type, label: type }))} onChange={(value) => update("wasteType", value)} />
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Quantity" type="number" value={form.quantity} placeholder="Enter quantity" onChange={(value) => update("quantity", parseNonNegativeNumber(value))} /><label className="block"><div className="mb-1 type-caption font-semibold text-text-secondary">Unit</div><div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{selectedItem?.unit || "Unit"}</div></label></div>
        <DatePickerField label="Waste Date" value={form.date} onChange={(value) => update("date", value)} />
        <TextArea label="Reason / Remark" value={form.notes} onChange={(value) => update("notes", value)} />
        <div><div className="mb-1 type-caption font-semibold text-text-secondary">Photo Evidence</div><div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-slate-50 p-3"><label className="btn-secondary h-8 cursor-pointer px-3 text-xs"><Upload size={14} /> Upload Photo<input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handlePhoto(event.target.files?.[0])} /></label>{form.photoUrl ? <><img className="h-12 w-12 rounded-xl border border-border object-cover" src={form.photoUrl} alt="Waste evidence preview" /><button className="btn-secondary h-8 px-3 text-xs text-rose-700" type="button" onClick={() => setForm((current) => ({ ...current, photoUrl: "", photoFile: null }))}>Remove</button></> : <span className="type-caption font-semibold text-text-muted">Optional evidence</span>}</div>{photoError ? <div className="mt-1 type-caption font-semibold text-amber-700">{photoError}</div> : null}</div>
      </div>
    </Modal>
  );
}
