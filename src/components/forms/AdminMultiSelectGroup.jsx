import { Check, ListChecks, X } from "lucide-react";
import "./AdminMultiSelectGroup.css";

export function AdminSelectionActions({ onSelectAll, onClear, allSelected, empty }) {
  return <div className="flex items-center gap-1.5">
    <button type="button" className="btn-secondary h-8 gap-1.5 px-2.5 text-xs" disabled={allSelected} onClick={onSelectAll}><ListChecks size={14} aria-hidden="true" />Select All</button>
    <button type="button" className="btn-ghost admin-selection-clear" disabled={empty} onClick={onClear}><X size={14} aria-hidden="true" />Clear</button>
  </div>;
}

export default function AdminMultiSelectGroup({ label, options, value, onChange, variant = "tiles", disabled = false, countLabel = "selected", className = "", optionsClassName = "", empty, children }) {
  function toggle(option, checked) {
    if (disabled || option.disabled) return;
    onChange(checked ? [...new Set([...value, option.value])] : value.filter(item => item !== option.value));
  }
  return <fieldset className={`admin-multi-select-group min-w-0 ${className}`} disabled={disabled}>
    <legend className="text-xs font-semibold text-text-secondary">{label}</legend>
    <div className="mb-2 mt-1 flex flex-wrap items-center justify-between gap-2"><span aria-live="polite" aria-atomic="true" className="text-xs text-text-muted">{value.length} {countLabel}</span>{children}</div>
    <div className={`admin-multi-select-options is-${variant} ${optionsClassName}`}>
      {options.map(option => {
        const selected = value.includes(option.value);
        return <label key={option.value} className="admin-multi-select-option" data-disabled={disabled || option.disabled || undefined}>
          <input type="checkbox" className="sr-only" aria-label={option.accessibleLabel || option.label} value={option.value} checked={selected} disabled={option.disabled} onChange={event => toggle(option, event.target.checked)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); toggle(option, !selected); } }} />
          <span className="admin-multi-select-surface">
            <Check aria-hidden="true" size={16} className={`admin-multi-select-check ${selected ? "" : "invisible"}`} />
            <span className="min-w-0 break-words"><span className="block">{option.label}</span>{option.description ? <span className="mt-0.5 block text-xs font-normal text-text-secondary">{option.description}</span> : null}</span>
          </span>
        </label>;
      })}
    </div>
    {!options.length ? empty : null}
  </fieldset>;
}
