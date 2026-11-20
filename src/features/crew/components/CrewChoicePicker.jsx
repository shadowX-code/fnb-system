import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewPickerField from "./CrewPickerField.jsx";

export function CrewChoiceList({ label, value, options, onChange }) {
  return <div className="crew-ui-choice-list crew-ui-choice-list--mint crew-choice-picker-options" role="listbox" aria-label={label}>
    {options.map(option => {
      const selected = option.value === value;
      return <button key={option.value} type="button" role="option" aria-selected={selected} className={selected ? "is-selected" : ""} onClick={() => onChange(option.value)}>
        <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
        {selected && <span className="crew-choice-picker-check"><Check size={16} /></span>}
      </button>;
    })}
  </div>;
}

/** Shared Crew single-choice field: a compact trigger backed by the canonical sheet/list vocabulary. */
export default function CrewChoicePicker({ label, value, options, onChange, placeholder, description, disabled = false, variant = "field" }) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t("picker.chooseOption");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <CrewPickerField label={label} display={selected?.label || resolvedPlaceholder} ariaLabel={resolvedPlaceholder} open={open}
    onOpen={() => setOpen(true)} disabled={disabled} variant={variant}>
    <CrewBottomSheet title={label || resolvedPlaceholder} description={description} onClose={() => setOpen(false)}>
      <CrewChoiceList label={label || resolvedPlaceholder} options={options} value={value} onChange={nextValue => { onChange(nextValue); setOpen(false); }} />
    </CrewBottomSheet>
  </CrewPickerField>;
}
