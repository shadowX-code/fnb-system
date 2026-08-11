import { CompactSelect } from "../FactoryBulkSelectionModal.jsx";

export default function FactoryDashboardUomSelect({ uoms, value, onChange, ariaLabel }) {
  if (uoms.length > 1) return <CompactSelect value={value} options={uoms.map((uom) => ({ value: uom, label: uom }))} onChange={onChange} ariaLabel={ariaLabel} />;
  return uoms.length === 1 ? <span className="inline-flex h-9 items-center rounded-lg border border-border bg-slate-50 px-3 text-xs font-bold text-text-secondary">{uoms[0]}</span> : null;
}
