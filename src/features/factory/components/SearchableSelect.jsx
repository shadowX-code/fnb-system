import { useRef, useState } from "react";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import { inputClass } from "./FactoryBulkSelectionModal.jsx";

export default function SearchableSelect({ value, options, placeholder, onChange, error, searchPlaceholder = "Search", emptyText = "No matching options", disabled = false, buttonRef }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const internalButtonRef = useRef(null);
  const anchorRef = internalButtonRef;
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) => `${option.label} ${option.helper || ""}`.toLowerCase().includes(query.toLowerCase()));

  function setButtonNode(node) {
    internalButtonRef.current = node;
    if (typeof buttonRef === "function") buttonRef(node);
    else if (buttonRef) buttonRef.current = node;
  }

  return (
    <div>
      <button ref={setButtonNode} className={`${inputClass(error)} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-70`} type="button" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span className={selected ? "text-text-primary" : "text-text-muted"}>{selected?.label || placeholder}</span>
        <span className="text-xs text-text-muted">Search</span>
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" minWidth={260} estimatedHeight={320} maxHeight={360} contentClassName="space-y-2">
        <div>
          <input className={inputClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus />
          <div className="mt-2 max-h-56 overflow-y-auto">
            {visibleOptions.length ? visibleOptions.map((option) => (
              <button key={option.value} className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-primary/10 ${option.value === value ? "bg-primary/10 font-bold text-primary" : "text-text-primary"}`} type="button" onClick={() => { onChange(option.value); setQuery(""); setOpen(false); }}>
                <span className="block">{option.label}</span>
                {option.helper ? <span className="block text-xs text-text-secondary">{option.helper}</span> : null}
              </button>
            )) : <div className="px-3 py-4 text-sm font-semibold text-text-secondary">{emptyText}</div>}
          </div>
        </div>
      </FloatingLayer>
    </div>
  );
}
