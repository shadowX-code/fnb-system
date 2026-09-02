import { useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";

function focusFirstInvalid(refs, firstKey) { setTimeout(() => { const node = refs.current?.[firstKey]; node?.scrollIntoView?.({ behavior: "smooth", block: "center" }); node?.focus?.({ preventScroll: true }); }, 0); }

const commonUoms = ["kg", "g", "litre", "ml", "pcs", "carton", "pail", "bottle", "pack"];
const packagingTypes = ["Pack", "Bottle", "Sachet", "Tub", "Pail", "Bag", "Carton", "Tray", "Box"];
const compactPackSizeText = (sku) => Number(sku?.pack_size_qty || 0) > 0 ? `${sku.pack_size_qty}${sku.pack_size_uom || ""}`.trim() : "";
const packagingTypeLabel = (sku) => sku?.packaging_type || "Pack";
const packagingSkuDisplayName = (sku) => [compactPackSizeText(sku), packagingTypeLabel(sku)].filter(Boolean).join(" ") || sku?.variant_name || "Packaging SKU";
export default function FinishedGoodMasterModal({ initialValue, categories, storageLocations = [], productFamilies = [], onClose, onSave, onArchive }) {
  const fieldRefs = useRef({});
  const [form, setForm] = useState(() => ({
    product_code: "",
    product_name: initialValue?.product_name || "",
    product_name_en: initialValue?.product_name_en || initialValue?.product_name || "",
    product_name_cn: "",
    product_name_bm: "",
    product_family_id: "",
    product_family_name: "",
    variant_name: "",
    packaging_type: "Pack",
    pack_size_qty: "",
    pack_size_uom: "kg",
    base_qty: "",
    base_uom: "",
    category_id: "",
    category: "",
    uom: "kg",
    min_stock_level: 0,
    shelf_life_days: "",
    storage_location_id: "",
    storage_location: "",
    recommended_storage: "",
    b2b_price: "",
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const selectedCategory = categories.find((category) => category.id === form.category_id);
  const selectedFamily = productFamilies.find((family) => family.id === form.product_family_id);
  const parentName = selectedFamily?.name_en || form.product_family_name || form.product_name_en || form.product_name || "Unassigned Finished Good";
  const parentCategory = selectedFamily?.category || selectedCategory?.name || form.category || "No category";
  const activeStorageLocations = storageLocations.filter((location) => (location.is_storage_location !== false && location.status === "active") || location.id === form.storage_location_id);
  const storageLocationOptions = [
    { value: "", label: "No Storage Location", helper: "Leave blank" },
    ...activeStorageLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") || location.status })),
  ];

  async function submit(event) {
    event.preventDefault();
    setError("");
    const nextErrors = {
      category_id: !form.category_id ? "Category is required." : "",
      product_code: !String(form.product_code || "").trim() ? "SKU Code is required." : "",
      product_name_en: !String(form.product_name_en || form.product_name || parentName || "").trim() ? "Finished Good name is required." : "",
      pack_size_qty: !Number(form.pack_size_qty || 0) ? "Pack Size Qty is required." : "",
      pack_size_uom: !String(form.pack_size_uom || "").trim() ? "Pack Size UOM is required." : "",
      uom: !String(form.uom || "").trim() ? "UOM is required." : "",
      shelf_life_days: form.shelf_life_days !== "" && (!Number.isInteger(Number(form.shelf_life_days)) || Number(form.shelf_life_days) <= 0) ? "Shelf Life must be a whole number greater than zero." : "",
      b2b_price: form.b2b_price !== "" && (!Number.isFinite(Number(form.b2b_price)) || Number(form.b2b_price) <= 0) ? "B2B Price must be greater than zero." : "",
      status: !String(form.status || "").trim() ? "Status is required." : "",
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
      const skuUom = form.pack_size_uom || form.uom;
      const variantName = packagingSkuDisplayName(form);
      const parentProductName = selectedFamily?.name_en || form.product_family_name || parentName;
      const productName = [parentProductName, variantName].filter(Boolean).join(" - ") || String(form.product_code || "").trim();
      await onSave({
        ...form,
        product_name: productName,
        product_name_en: productName,
        product_name_cn: selectedFamily?.name_cn || form.product_name_cn || "",
        product_name_bm: selectedFamily?.name_bm || form.product_name_bm || "",
        category: selectedCategory?.name || selectedFamily?.category || form.category || "",
        product_family_id: selectedFamily?.id || form.product_family_id || "",
        product_family_name: parentProductName || "",
        variant_name: variantName,
        packaging_type: form.packaging_type || "Pack",
        base_qty: form.pack_size_qty,
        base_uom: skuUom,
        uom: skuUom,
      });
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
      title={initialValue?.id ? "Edit Packaging SKU" : "Add Packaging SKU"}
      description={`${initialValue?.id ? "Edit" : "Add"} a packaging SKU under ${parentName}.`}
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          {initialValue?.id && initialValue.status !== "archived" ? <button className="btn-danger" type="button" disabled={saving} onClick={archive}>Archive</button> : <span />}
          <div className="flex gap-2">
            {error ? <div className="self-center text-sm font-semibold text-rose-600">{error}</div> : null}
            <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" form="factory-finished-good-form" disabled={saving}>{saving ? "Saving..." : "Save Packaging SKU"}</button>
          </div>
        </>
      )}
    >
      <form id="factory-finished-good-form" className="space-y-4" onSubmit={submit}>
        <div className="space-y-5">
          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="text-[10.5px] font-semibold text-[rgb(107,114,128)]">Finished Good</div>
            <div className="mt-1 text-lg font-bold text-text-primary">{parentName}</div>
            <div className="mt-1 text-sm font-semibold text-text-secondary">Category: {parentCategory}</div>
            {fieldErrors.category_id ? <div className="mt-2 text-xs font-semibold text-rose-600">Edit the Finished Good and select a category before adding Packaging SKUs.</div> : null}
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
            <Field label="SKU Code *" error={fieldErrors.product_code}>
              <input ref={(node) => { fieldRefs.current.product_code = node; }} className={inputClass(fieldErrors.product_code)} value={form.product_code || ""} onChange={(event) => {
                setFieldErrors((current) => ({ ...current, product_code: "" }));
                setForm((current) => ({ ...current, product_code: event.target.value }));
              }} />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Packaging Type">
                <SearchableSelect
                  value={form.packaging_type || "Pack"}
                  options={packagingTypes.map((type) => ({ value: type, label: type }))}
                  placeholder="Select Packaging Type"
                  searchPlaceholder="Search packaging types"
                  onChange={(packagingType) => setForm((current) => ({ ...current, packaging_type: packagingType }))}
                />
              </Field>
              <Field label="Pack Size Qty *" error={fieldErrors.pack_size_qty}>
                <input ref={(node) => { fieldRefs.current.pack_size_qty = node; }} className={inputClass(fieldErrors.pack_size_qty)} type="number" min="0" step="0.0001" value={form.pack_size_qty ?? ""} onChange={(event) => {
                  const value = event.target.value;
                  setFieldErrors((current) => ({ ...current, pack_size_qty: "" }));
                  setForm((current) => ({
                    ...current,
                    pack_size_qty: value,
                    base_qty: value,
                  }));
                }} />
              </Field>
              <Field label="Pack Size UOM *" error={fieldErrors.pack_size_uom}>
                <SearchableSelect
                  value={form.pack_size_uom || "kg"}
                  options={commonUoms.map((uom) => ({ value: uom, label: uom }))}
                  placeholder="Select UOM"
                  searchPlaceholder="Search UOM"
                  error={fieldErrors.pack_size_uom}
                  onChange={(value) => {
                  setFieldErrors((current) => ({ ...current, pack_size_uom: "", uom: "" }));
                  setForm((current) => ({
                    ...current,
                    pack_size_uom: value,
                    base_uom: value,
                    uom: value,
                  }));
                }}
                />
              </Field>
            </div>
            <div className="rounded-xl border border-border bg-white px-3 py-2">
              <div className="text-[10.5px] font-semibold text-text-muted">Display</div>
              <div className="mt-1 text-sm font-bold text-text-primary">{packagingSkuDisplayName(form)}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Shelf Life (Days)" error={fieldErrors.shelf_life_days}>
                <input
                  className={inputClass(fieldErrors.shelf_life_days)}
                  type="number"
                  min="1"
                  step="1"
                  placeholder="No expiry"
                  value={form.shelf_life_days ?? ""}
                  onChange={(event) => {
                    setFieldErrors((current) => ({ ...current, shelf_life_days: "" }));
                    setForm((current) => ({ ...current, shelf_life_days: event.target.value }));
                  }}
                />
              </Field>
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
              <Field label="Storage">
                <SearchableSelect
                  value={form.recommended_storage || ""}
                  options={[
                    { value: "", label: "Not Set" },
                    { value: "room", label: "Room" },
                    { value: "chiller", label: "Chiller" },
                    { value: "freezer", label: "Freezer" },
                  ]}
                  placeholder="Not Set"
                  searchPlaceholder="Search storage methods"
                  onChange={(recommendedStorage) => setForm((current) => ({ ...current, recommended_storage: recommendedStorage }))}
                />
                <div className="mt-1 text-xs text-text-secondary">Recommended product storage method, separate from the physical Storage Location.</div>
              </Field>
              <Field label="B2B Price (RM)" error={fieldErrors.b2b_price}>
                <input
                  className={inputClass(fieldErrors.b2b_price)}
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="Not set"
                  value={form.b2b_price ?? ""}
                  onChange={(event) => {
                    setFieldErrors((current) => ({ ...current, b2b_price: "" }));
                    setForm((current) => ({ ...current, b2b_price: event.target.value }));
                  }}
                />
              </Field>
            </div>
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
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
            <div>
              <div className="text-sm font-semibold text-text-primary">Notes</div>
              <div className="mt-1 text-sm text-text-secondary">Internal remarks for warehouse and production teams.</div>
            </div>
            <Field label="Remarks">
              <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
            </Field>
          </section>
        </div>
      </form>
    </Modal>
  );
}
