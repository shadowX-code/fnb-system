import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

// Shared mobile numeric control for operational counts. The input remains
// editable for stocktakes larger than a few taps.
export default function CrewQuantityStepper({ value, onChange, min = 0, step = 1, label, unit = "" }) {
  const { t } = useTranslation();
  const resolvedLabel = label || t("assets.quantity");
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : min;
  const update = (next) => onChange(String(Math.max(min, next)));

  return <div className="crew-ui-quantity-stepper">
    <span className="crew-ui-quantity-stepper-label">{resolvedLabel}</span>
    <div>
      <button type="button" onClick={() => update(safeValue - step)} disabled={safeValue <= min} aria-label={t("picker.decrease", { label: resolvedLabel })}><Minus size={18} /></button>
      <label>
        <span className="sr-only">{resolvedLabel}</span>
        <input aria-label={resolvedLabel} type="number" min={min} step="any" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
        {unit ? <small>{unit}</small> : null}
      </label>
      <button type="button" onClick={() => update(safeValue + step)} aria-label={t("picker.increase", { label: resolvedLabel })}><Plus size={18} /></button>
    </div>
  </div>;
}
