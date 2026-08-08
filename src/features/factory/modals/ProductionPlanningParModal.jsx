import { useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { quantity } from "../utils/factoryFormatters.js";

const packagingTypeLabel = (sku) => sku?.packaging_type || "Pack";
const pluralizePackagingType = (type, value) => { const label = type || "Pack"; return Number(value || 0) === 1 ? label : /ch$/i.test(label) ? `${label}es` : `${label}s`; };
const packagingSkuDisplayName = (sku) => [Number(sku?.pack_size_qty || 0) > 0 ? `${sku.pack_size_qty}${sku.pack_size_uom || ""}`.trim() : "", packagingTypeLabel(sku)].filter(Boolean).join(" ") || sku?.variant_name || "Packaging SKU";
const skuBalanceLabel = (sku) => { const value = Number(sku?.current_balance || 0); return quantity(value, pluralizePackagingType(packagingTypeLabel(sku), value)); };
export default function ProductionPlanningParModal({ sku, onClose, onSave }) {
  const [parLevel, setParLevel] = useState(sku?.min_stock_level ? String(sku.min_stock_level) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const packagingUnit = pluralizePackagingType(packagingTypeLabel(sku), Number(parLevel || sku?.min_stock_level || 0));

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (parLevel !== "" && Number(parLevel) < 0) {
      setError("Par Level cannot be negative.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ sku, par_level: parLevel });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Set Par Level"
      description="Set the target warehouse stock level for this Packaging SKU."
      size="md"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="production-planning-par-form" disabled={saving}>{saving ? "Saving..." : "Save Par Level"}</button>
        </>
      )}
    >
      <form id="production-planning-par-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="rounded-2xl border border-border bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">Packaging SKU</div>
          <div className="mt-1 text-lg font-bold text-text-primary">{sku?.product_code || "SKU"}</div>
          <div className="text-sm font-semibold text-text-secondary">{packagingSkuDisplayName(sku)}</div>
          <div className="mt-2 text-sm text-text-secondary">Current Balance: <span className="font-bold text-text-primary">{skuBalanceLabel(sku)}</span></div>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_140px] md:items-end">
          <Field label="Par Level Qty">
            <input className={inputClass()} type="number" min="0" step="0.001" value={parLevel} onChange={(event) => setParLevel(event.target.value)} placeholder="e.g. 100" />
          </Field>
          <Field label="Unit">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-secondary">{packagingUnit}</div>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

