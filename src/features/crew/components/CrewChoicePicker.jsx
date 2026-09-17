import { ChevronDown, Check } from "lucide-react";
import { useId, useState } from "react";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import "./CrewChoicePicker.css";

/** Shared Crew single-choice field: a compact trigger backed by the canonical sheet/list vocabulary. */
export default function CrewChoicePicker({ label, value, options, onChange, placeholder = "Choose an option", description }) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const selected = options.find((option) => option.value === value);
  return <div className="crew-choice-picker">
    {label ? <span id={labelId}>{label}</span> : null}
    <button type="button" className="crew-choice-picker-trigger" aria-labelledby={label ? labelId : undefined} aria-label={label || placeholder} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <strong>{selected?.label || placeholder}</strong><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open ? <CrewBottomSheet title={label || placeholder} description={description} onClose={() => setOpen(false)}>
      <div className="crew-ui-choice-list crew-ui-choice-list--mint" role="listbox" aria-label={label || placeholder}>
        {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "is-selected" : ""} onClick={() => { onChange(option.value); setOpen(false); }}><span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>{option.value === value ? <span className="crew-choice-picker-check"><Check size={16} /></span> : null}</button>)}
      </div>
    </CrewBottomSheet> : null}
  </div>;
}
