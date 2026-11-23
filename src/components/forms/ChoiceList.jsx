import { Check } from "lucide-react";

const adminRow = "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm text-text-primary focus-visible:ring-2 focus-visible:ring-primary";

export default function ChoiceList({ label, value, options, onChange, crew = false, compact = false }) {
  return <div
    className={crew ? "crew-ui-choice-list crew-ui-choice-list--mint crew-choice-picker-options" : "grid gap-2"}
    role="listbox"
    aria-label={label}
  >
    {options.map((option) => {
      const selected = option.value === value;
      const adminState = selected ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-primary/50";
      const row = crew ? `${selected ? "is-selected" : ""}${compact ? " !min-h-11 !py-2" : ""}` : `${adminRow} ${adminState}`;
      return <button key={option.value} type="button" role="option" aria-selected={selected} className={row} onClick={() => onChange(option.value)}>
        <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
        {selected && <span className={crew ? "crew-choice-picker-check" : "shrink-0 text-primary"}><Check size={16} aria-hidden="true" /></span>}
      </button>;
    })}
  </div>;
}
