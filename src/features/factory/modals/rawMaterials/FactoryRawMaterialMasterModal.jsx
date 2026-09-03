import { useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";
import { factoryService } from "../../../../services/factoryService.js";
import { IMAGE_UPLOAD_ACCEPT } from "../../../../utils/imageUpload.js";
import { money } from "../../utils/factoryFormatters.js";
import { commonFactoryUoms, dimensionalFactoryUom, normalizeFactoryUom } from "../../utils/factoryUomConversions.js";

function focusFirstInvalid(refs, firstKey) { setTimeout(() => { const node = refs.current?.[firstKey]; node?.scrollIntoView?.({ behavior: "smooth", block: "center" }); node?.focus?.({ preventScroll: true }); }, 0); }

const normalizedCostUnit = (uom) => {
  return dimensionalFactoryUom(uom);
};
export default function RawMaterialMasterModal({ initialValue, categories, storageLocations = [], onClose, onSave }) {
  const fieldRefs = useRef({});
  const [form, setForm] = useState(() => ({
    material_code: "",
    name: initialValue?.name || "",
    name_en: initialValue?.name_en || initialValue?.name || "",
    name_cn: "",
    name_bm: "",
    image_url: "",
    category_id: "",
    category: "",
    uom: "kg",
    conversion_package_quantity: "",
    conversion_base_uom: "",
    min_stock_level: 0,
    par_level: "",
    manual_unit_cost: "",
    manual_cost_uom: "kg",
    expiry_tracking_mode: "optional",
    shelf_life_days: "",
    storage_location_id: "",
    storage_location: "",
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [isRawMaterialImageUploading, setIsRawMaterialImageUploading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const activeCategories = categories.filter((category) => category.status === "active" || category.id === form.category_id);
  const categoryOptions = activeCategories.map((category) => ({ value: category.id, label: category.name, helper: category.description || category.status }));
  const activeStorageLocations = storageLocations.filter((location) => (location.is_storage_location !== false && location.status === "active") || location.id === form.storage_location_id);
  const storageLocationOptions = [
    { value: "", label: "No Storage Location", helper: "Leave blank" },
    ...activeStorageLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") || location.status })),
  ];
  const hasConversion = Boolean(form.conversion_package_quantity || form.conversion_base_uom);
  const baseOptions = commonFactoryUoms.filter((uom) => Boolean(dimensionalFactoryUom(uom))).map((uom) => ({ value: uom, label: dimensionalFactoryUom(uom)?.display || uom }));
  const updateUomContract = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    const nextErrors = {
      category_id: !form.category_id ? "Category is required." : "",
      material_code: !String(form.material_code || "").trim() ? "SKU Code is required." : "",
      name_en: !String(form.name_en || "").trim() ? "Raw Material Name (EN) is required." : "",
      uom: !String(form.uom || "").trim() ? "Storage UOM is required." : "",
      conversion_package_quantity: hasConversion && (!Number.isFinite(Number(form.conversion_package_quantity)) || Number(form.conversion_package_quantity) <= 0) ? "Conversion quantity must be greater than zero." : "",
      conversion_base_uom: hasConversion && !String(form.conversion_base_uom || "").trim() ? "Base UOM is required." : "",
      par_level: form.par_level !== "" && (!Number.isFinite(Number(form.par_level)) || Number(form.par_level) < 0) ? "Par Level must be zero or greater." : "",
      status: !String(form.status || "").trim() ? "Status is required." : "",
      shelf_life_days: form.shelf_life_days !== "" && (!Number.isInteger(Number(form.shelf_life_days)) || Number(form.shelf_life_days) <= 0) ? "Shelf Life must be a whole number greater than zero." : "",
    };
    const activeErrors = Object.fromEntries(Object.entries(nextErrors).filter(([, message]) => message));
    setFieldErrors(activeErrors);
    const firstError = Object.keys(activeErrors)[0];
    if (firstError) {
      setError("Please complete required fields.");
      focusFirstInvalid(fieldRefs, firstError);
      return;
    }
    setSaving(true);
    try {
      const selectedCategory = categories.find((category) => category.id === form.category_id);
      await onSave({ ...form, name: form.name_en, category: selectedCategory?.name || "" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Raw Material" : "Create Raw Material"}
      description="Raw Material Master defines valid materials for receiving, recipes and production usage."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <span />
          <div className="flex gap-2">
            {error ? <div className="self-center text-sm font-semibold text-rose-600">{error}</div> : null}
            <button className="btn-secondary" type="button" disabled={saving || isRawMaterialImageUploading} onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" form="factory-raw-material-form" disabled={saving || isRawMaterialImageUploading}>{saving ? "Saving..." : "Save Raw Material"}</button>
          </div>
        </>
      )}
    >
      <form id="factory-raw-material-form" className="space-y-4" onSubmit={submit}>
        <Field label="Category *" error={fieldErrors.category_id}>
          <SearchableSelect
            value={form.category_id || ""}
            options={categoryOptions}
            placeholder="Select Category"
            error={Boolean(fieldErrors.category_id)}
            buttonRef={(node) => { fieldRefs.current.category_id = node; }}
            onChange={(categoryId) => {
              setFieldErrors((current) => ({ ...current, category_id: "" }));
              setForm((current) => ({ ...current, category_id: categoryId }));
            }}
          />
        </Field>
        <Field label="SKU Code *" error={fieldErrors.material_code}>
          <input ref={(node) => { fieldRefs.current.material_code = node; }} className={inputClass(fieldErrors.material_code)} value={form.material_code || ""} onChange={(event) => {
            setFieldErrors((current) => ({ ...current, material_code: "" }));
            setForm((current) => ({ ...current, material_code: event.target.value }));
          }} />
        </Field>
        <Field label="Raw Material Name (EN) *" error={fieldErrors.name_en}>
          <input ref={(node) => { fieldRefs.current.name_en = node; }} className={inputClass(fieldErrors.name_en)} value={form.name_en || ""} onChange={(event) => {
            setFieldErrors((current) => ({ ...current, name_en: "" }));
            setForm((current) => ({ ...current, name_en: event.target.value, name: event.target.value }));
          }} />
        </Field>
        <section className="space-y-3">
          <div>
            <div className="text-sm font-bold text-text-primary">Image</div>
            <div className="text-xs font-semibold text-text-secondary">Optional image for raw material identification.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`btn-secondary cursor-pointer ${isRawMaterialImageUploading ? "opacity-70" : ""}`}>
              {isRawMaterialImageUploading ? "Uploading..." : "Upload Image"}
              <input
                className="sr-only"
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                disabled={isRawMaterialImageUploading}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setIsRawMaterialImageUploading(true);
                  setError("");
                  try {
                    const uploaded = await factoryService.uploadRawMaterialImage(file, form);
                    setForm((current) => ({ ...current, image_url: uploaded.publicUrl }));
                  } catch (uploadError) {
                    setError(uploadError.message || "Unable to upload image.");
                  } finally {
                    setIsRawMaterialImageUploading(false);
                  }
                }}
              />
            </label>
            {form.image_url ? <button className="btn-secondary" type="button" disabled={isRawMaterialImageUploading} onClick={() => setForm((current) => ({ ...current, image_url: "" }))}>Remove Image</button> : null}
          </div>
          {form.image_url ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-slate-50 p-3">
              <img className="h-16 w-16 rounded-lg object-cover" src={form.image_url} alt={form.name_en || "Raw material"} />
              <div className="text-xs font-bold text-text-primary">Preview</div>
            </div>
          ) : null}
        </section>
        <Field label="Storage UOM *" error={fieldErrors.uom}>
          <SearchableSelect
            value={form.uom}
            options={commonFactoryUoms.map((uom) => ({ value: uom, label: dimensionalFactoryUom(uom)?.display || uom }))}
            placeholder="Select UOM"
            searchPlaceholder="Search UOM"
            error={fieldErrors.uom}
            onChange={(uom) => {
              setFieldErrors((current) => ({ ...current, uom: "" }));
              updateUomContract({ uom });
            }}
          />
        </Field>
        <section className="space-y-3 rounded-lg border border-border bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-sm font-bold text-text-primary">UOM & Conversion</div><div className="text-xs font-semibold text-text-secondary">Define the Storage UOM conversion once. Recipe usage uses the Base UOM.</div></div>
            <input aria-label="UOM conversion" type="checkbox" checked={hasConversion} onChange={(event) => updateUomContract(event.target.checked ? { conversion_package_quantity: form.conversion_package_quantity || "", conversion_base_uom: form.conversion_base_uom || "kg" } : { conversion_package_quantity: "", conversion_base_uom: "" })} />
          </div>
          {hasConversion ? <div className="grid items-end gap-3 sm:grid-cols-2">
            <Field label="Contains" error={fieldErrors.conversion_package_quantity}><input className={inputClass(fieldErrors.conversion_package_quantity)} type="number" min="0.0001" step="0.0001" value={form.conversion_package_quantity ?? ""} onChange={(event) => updateUomContract({ conversion_package_quantity: event.target.value })} /></Field>
            <Field label="Base UOM" error={fieldErrors.conversion_base_uom}><SearchableSelect value={form.conversion_base_uom || ""} options={baseOptions} placeholder="Base UOM" searchPlaceholder="Search UOM" onChange={(conversionBaseUom) => updateUomContract({ conversion_base_uom: conversionBaseUom })} /></Field>
          </div> : null}
        </section>
        <Field label={`Par Level${form.uom ? ` (${form.uom})` : ""}`}>
          <input className={inputClass()} type="number" min="0" step="0.0001" placeholder="Optional target stock level" value={form.par_level ?? ""} onChange={(event) => setForm((current) => ({ ...current, par_level: event.target.value }))} />
          <div className="mt-1 text-xs font-semibold text-text-secondary">Target / ideal stock level. Minimum Stock remains the low-stock threshold.</div>
        </Field>
        <section className="space-y-3 rounded-xl border border-border bg-slate-50 p-3">
          <div>
            <div className="text-sm font-bold text-text-primary">Cost Information</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Unit Cost">
              <input className={inputClass()} type="number" min="0" step="0.0001" placeholder="10" value={form.manual_unit_cost ?? ""} onChange={(event) => setForm((current) => ({ ...current, manual_unit_cost: event.target.value }))} />
            </Field>
            <Field label="Cost UOM">
              <SearchableSelect
                value={form.manual_cost_uom || ""}
                options={commonFactoryUoms.map((uom) => ({ value: uom, label: dimensionalFactoryUom(uom)?.display || uom }))}
                placeholder="Select Cost UOM"
                searchPlaceholder="Search UOM"
                onChange={(manualCostUom) => setForm((current) => ({ ...current, manual_cost_uom: manualCostUom }))}
              />
            </Field>
          </div>
          <div className="text-xs font-semibold text-text-secondary">
            {Number(form.manual_unit_cost || 0) > 0 && form.manual_cost_uom ? `${money(form.manual_unit_cost)} / ${normalizedCostUnit(form.manual_cost_uom)?.display || form.manual_cost_uom}` : "Add a manual fallback cost if this material has no receiving cost yet."}
          </div>
        </section>
        <Field label="Storage Location">
          <SearchableSelect
            value={form.storage_location_id || ""}
            options={storageLocationOptions}
            placeholder="Select Storage Location"
            searchPlaceholder="Search locations"
            emptyText="No storage locations"
            onChange={(locationId) => setForm((current) => ({ ...current, storage_location_id: locationId }))}
          />
        </Field>
        <section className="space-y-3 rounded-xl border border-border bg-slate-50 p-3">
          <div className="text-sm font-bold text-text-primary">Expiry Tracking</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expiry Tracking Mode">
              <SearchableSelect
                value={form.expiry_tracking_mode || "optional"}
                options={[
                  { value: "required", label: "Required" },
                  { value: "optional", label: "Optional" },
                  { value: "not_applicable", label: "Not Applicable" },
                ]}
                placeholder="Select mode"
                onChange={(expiryTrackingMode) => setForm((current) => ({ ...current, expiry_tracking_mode: expiryTrackingMode, shelf_life_days: expiryTrackingMode === "not_applicable" ? "" : current.shelf_life_days }))}
              />
            </Field>
            <Field label="Shelf Life (Days)" error={fieldErrors.shelf_life_days}>
              <input className={inputClass(fieldErrors.shelf_life_days)} type="number" min="1" step="1" disabled={form.expiry_tracking_mode === "not_applicable"} value={form.shelf_life_days ?? ""} onChange={(event) => {
                setFieldErrors((current) => ({ ...current, shelf_life_days: "" }));
                setForm((current) => ({ ...current, shelf_life_days: event.target.value }));
              }} />
            </Field>
          </div>
        </section>
        <Field label="Status *" error={fieldErrors.status}>
          <SearchableSelect
            value={form.status}
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
            placeholder="Select Status"
            searchPlaceholder="Search status"
            error={fieldErrors.status}
            onChange={(status) => {
              setFieldErrors((current) => ({ ...current, status: "" }));
              setForm((current) => ({ ...current, status }));
            }}
          />
        </Field>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}
