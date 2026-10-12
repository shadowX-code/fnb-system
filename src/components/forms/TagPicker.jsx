import { useState } from "react";
import { X, Plus } from "lucide-react";
import SelectField from "./SelectField.jsx";

/** Tag composition only; canonical SelectField owns search, popup and keyboard behavior. */
export default function TagPicker({ label = "Tags", value = [], options = [], onChange, allowCreate = false, placeholder = "All", disabled = false }) {
  const [newTag, setNewTag] = useState("");
  const tags = [...new Set(options.concat(value))].sort((a, b) => a.localeCompare(b));
  const candidate = newTag.trim();
  const add = tag => { if (!value.includes(tag) && value.length < 20) onChange([...value, tag]); };
  return <div className="admin-tag-picker min-w-0">
    <SelectField label={label} ariaLabel={label} value="" placeholder={placeholder} disabled={disabled || value.length >= 20} searchable options={tags.filter(tag => !value.includes(tag)).map(tag => ({ value: tag, label: tag }))} onChange={add}
      emptyText={allowCreate ? "No matching tags. Add a tag below." : "No matching tags"}
      footerAction={allowCreate ? ({close}) => <div className="flex min-w-0 gap-2"><input className="control min-w-0" aria-label="New tag" placeholder="New tag" maxLength={60} value={newTag} onChange={event => setNewTag(event.target.value)} onKeyDown={event => { if(event.key === "Enter") { event.preventDefault(); if(candidate && !value.includes(candidate)) { add(candidate); setNewTag(""); close(); } } }}/><button type="button" className="btn-secondary shrink-0" aria-label="Add tag" disabled={!candidate || value.includes(candidate)} onClick={() => { add(candidate); setNewTag(""); close(); }}><Plus size={14}/></button></div> : null}/>
    {value.length > 0 ? <div className="mt-2 flex flex-wrap gap-1" aria-label="Selected tags">{value.map(tag => <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-text-primary" key={tag}><span className="break-all">{tag}</span><button type="button" className="icon-btn shrink-0" aria-label={`Remove tag ${tag}`} disabled={disabled} onClick={() => onChange(value.filter(item => item !== tag))}><X size={12}/></button></span>)}</div> : null}
  </div>;
}
