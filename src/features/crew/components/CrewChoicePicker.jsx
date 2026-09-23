import { ChevronDown, Check } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import "./CrewChoicePicker.css";

/** Shared Crew single-choice field: a compact trigger backed by the canonical sheet/list vocabulary. */
export default function CrewChoicePicker({ label, value, options, onChange, placeholder, description, disabled = false, variant = "field" }) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t("picker.chooseOption");
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const selected = options.find((option) => option.value === value);
  return <div className={`crew-choice-picker${variant === "context" ? " crew-choice-picker--context" : ""}`}>
    {label ? <span id={labelId}>{label}</span> : null}
    <button type="button" className="crew-choice-picker-trigger" aria-labelledby={label ? variant === "context" ? `${labelId} ${valueId}` : labelId : undefined} aria-label={label ? undefined : resolvedPlaceholder} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <strong id={valueId}>{selected?.label || resolvedPlaceholder}</strong><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open ? <CrewBottomSheet title={label || resolvedPlaceholder} description={description} onClose={() => setOpen(false)}>
      <div className="crew-ui-choice-list crew-ui-choice-list--mint crew-choice-picker-options" role="listbox" aria-label={label || resolvedPlaceholder}>
        {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "is-selected" : ""} onClick={() => { onChange(option.value); setOpen(false); }}><span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>{option.value === value ? <span className="crew-choice-picker-check"><Check size={16} /></span> : null}</button>)}
      </div>
    </CrewBottomSheet> : null}
  </div>;
}
