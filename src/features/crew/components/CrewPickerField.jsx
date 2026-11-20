import { useId } from "react";
import { ChevronDown } from "lucide-react";
import "./CrewChoicePicker.css";

export default function CrewPickerField({ label, display, ariaLabel = display, open, onOpen, disabled, variant = "field", className = "", children }) {
  const labelId = useId();
  const valueId = useId();
  return <div className={`crew-choice-picker${variant === "context" ? " crew-choice-picker--context" : ""} ${className}`}>
    {label && <span id={labelId}>{label}</span>}
    <button type="button" className="crew-choice-picker-trigger"
      aria-labelledby={label ? variant === "context" ? `${labelId} ${valueId}` : labelId : undefined}
      aria-label={label ? undefined : ariaLabel} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={onOpen}>
      <strong id={valueId}>{display}</strong><ChevronDown size={18} aria-hidden="true" />
    </button>
    {open && children}
  </div>;
}
