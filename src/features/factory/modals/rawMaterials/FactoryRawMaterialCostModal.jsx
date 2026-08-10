import { useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";
import { rawMaterialLabel } from "../../utils/factoryFormatters.js";

const commonUoms = ["kg", "g", "litre", "ml", "pcs", "carton", "pail", "bottle", "pack"];
export default function RawMaterialCostModal({ material, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    manual_unit_cost: material?.manual_unit_cost ?? "",
    manual_cost_uom: material?.manual_cost_uom || material?.uom || "kg",
  }));
  const [saving, setSaving] = useState(false);
  const receivingCostActive = material?.latest_cost_source === "Receiving Cost";

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...material,
        manual_unit_cost: form.manual_unit_cost,
        manual_cost_uom: form.manual_cost_uom,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Update Unit Cost"
      description="Update the fallback master cost for this raw material."
      size="sm"
      onClose={saving ? undefined : onClose}
      footer={(
        <div className="flex w-full justify-end gap-2">
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-raw-material-cost-form" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      )}
    >
      <form id="factory-raw-material-cost-form" className="space-y-4" onSubmit={submit}>
        <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
          <div className="text-sm font-bold text-text-primary">{rawMaterialLabel(material)}</div>
          <div className="text-xs font-semibold text-text-secondary">{material?.material_code || "Raw Material"}</div>
        </div>
        {receivingCostActive ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Receiving cost is currently used. Unit Cost is fallback when no receiving cost exists.
          </div>
        ) : null}
        <Field label="Unit Cost">
          <input className={inputClass()} type="number" min="0" step="0.0001" value={form.manual_unit_cost ?? ""} onChange={(event) => setForm((current) => ({ ...current, manual_unit_cost: event.target.value }))} />
        </Field>
        <Field label="Cost UOM">
          <SearchableSelect
            value={form.manual_cost_uom || ""}
            options={commonUoms.map((uom) => ({ value: uom, label: uom }))}
            placeholder="Select Cost UOM"
            searchPlaceholder="Search UOM"
            onChange={(manualCostUom) => setForm((current) => ({ ...current, manual_cost_uom: manualCostUom }))}
          />
        </Field>
      </form>
    </Modal>
  );
}
