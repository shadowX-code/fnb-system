import { Check, ChevronDown, Search, UserRound } from "lucide-react";
import { useId, useMemo, useState } from "react";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import "./CrewPersonPicker.css";

const initials = (name) => String(name || "Crew").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

/** Shared Crew people selector for small, authorized person sets. */
export default function CrewPersonPicker({ label, value, people = [], onChange, placeholder = "Choose Crew", description, disabled = false, searchLabel = "Search Crew" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelId = useId();
  const selected = people.find((person) => person.id === value);
  const visiblePeople = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? people.filter((person) => `${person.name || ""} ${person.position || ""}`.toLowerCase().includes(normalized)) : people;
  }, [people, query]);

  return <div className="crew-person-picker">
    {label ? <span id={labelId}>{label}</span> : null}
    <button type="button" className="crew-person-picker-trigger" aria-labelledby={label ? labelId : undefined} aria-label={label || placeholder} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setQuery(""); setOpen(true); }}>
      {selected ? <PersonIdentity person={selected} /> : <strong>{placeholder}</strong>}
      <ChevronDown size={18} aria-hidden="true" />
    </button>
    {open ? <CrewBottomSheet title={placeholder} description={description} onClose={() => setOpen(false)}>
      <label className="crew-ui-form-field crew-person-picker-search"><span className="sr-only">{searchLabel}</span><Search size={18} aria-hidden="true" /><input autoFocus aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="crew-ui-choice-list crew-ui-choice-list--mint crew-person-picker-options" role="listbox" aria-label={label || placeholder}>
        {visiblePeople.map((person) => <button key={person.id} type="button" role="option" aria-label={[person.name, person.position].filter(Boolean).join(" · ")} aria-selected={person.id === value} className={person.id === value ? "is-selected" : ""} onClick={() => { onChange(person.id); setOpen(false); }}><PersonIdentity person={person} />{person.id === value ? <span className="crew-person-picker-check"><Check size={16} /></span> : null}</button>)}
        {!visiblePeople.length ? <p role="status">No Crew found</p> : null}
      </div>
    </CrewBottomSheet> : null}
  </div>;
}

export function PersonIdentity({ person }) {
  return <span className="crew-person-picker-identity"><span className="crew-person-picker-avatar" aria-hidden="true">{initials(person?.name)}</span><span><strong>{person?.name || "Crew"}</strong>{person?.position ? <small>{person.position}</small> : null}</span></span>;
}
