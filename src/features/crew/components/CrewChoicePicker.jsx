import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewPickerField from "./CrewPickerField.jsx";

/** Shared Crew single-choice field: a compact trigger backed by the canonical sheet/list vocabulary. */
export default function CrewChoicePicker({ label, value, options, onChange, placeholder, description, disabled = false, variant = "field" }) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t("picker.chooseOption");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <CrewPickerField label={label} display={selected?.label || resolvedPlaceholder} ariaLabel={resolvedPlaceholder} open={open}
    onOpen={() => setOpen(true)} disabled={disabled} variant={variant}>
    <CrewBottomSheet title={label || resolvedPlaceholder} description={description} onClose={() => setOpen(false)}>
      <div className="crew-ui-choice-list crew-ui-choice-list--mint crew-choice-picker-options" role="listbox" aria-label={label || resolvedPlaceholder}>
        {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "is-selected" : ""} onClick={() => { onChange(option.value); setOpen(false); }}><span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>{option.value === value ? <span className="crew-choice-picker-check"><Check size={16} /></span> : null}</button>)}
      </div>
    </CrewBottomSheet>
  </CrewPickerField>;
}
