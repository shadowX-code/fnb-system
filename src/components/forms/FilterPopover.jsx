import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import FloatingLayer from "../ui/FloatingLayer.jsx";

function normalizeValue(value, multiple) {
  if (multiple) return Array.isArray(value) ? value : value ? [value] : [];
  return value ?? "";
}

function getDisplayText({ options, value, multiple, placeholder }) {
  if (multiple) {
    const selected = options.filter((option) => value.includes(option.value));
    if (!selected.length) return placeholder;
    if (selected.length === 1) return selected[0].label;
    if (selected.length === 2) return selected.map((option) => option.label).join(" + ");
    return `${selected.length} selected`;
  }
  return options.find((option) => option.value === value)?.label ?? placeholder;
}

export default function FilterPopover({
  label,
  value,
  options,
  onApply,
  multiple = false,
  placeholder = "All",
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(() => normalizeValue(value, multiple));
  const containerRef = useRef(null);

  const selectedValue = useMemo(() => normalizeValue(value, multiple), [multiple, value]);
  const hasSelection = multiple ? selectedValue.length > 0 : Boolean(selectedValue);
  const displayText = getDisplayText({ options, value: selectedValue, multiple, placeholder });

  useEffect(() => {
    if (!isOpen) return;
    setDraftValue(selectedValue);
  }, [isOpen, selectedValue]);

  function toggleOption(optionValue) {
    if (!multiple) {
      setDraftValue(optionValue);
      return;
    }
    setDraftValue((current) => {
      const next = new Set(current);
      if (next.has(optionValue)) next.delete(optionValue);
      else next.add(optionValue);
      return [...next];
    });
  }

  function clearSelection() {
    const emptyValue = multiple ? [] : "";
    setDraftValue(emptyValue);
    onApply(emptyValue);
    setIsOpen(false);
  }

  function applySelection() {
    onApply(draftValue);
    setIsOpen(false);
  }

  return (
    <div className={`relative min-w-0 ${className}`} ref={containerRef}>
      {label ? <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div> : null}
      <button
        className={`flex h-9 w-full min-w-36 items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/15 ${
          isOpen ? "border-primary/50 shadow-sm" : "border-border hover:border-slate-300 hover:bg-slate-50"
        }`}
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate ${hasSelection ? "text-text-primary" : "text-text-secondary"}`}>{displayText}</span>
          {hasSelection ? <span className="hidden rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary sm:inline">Active</span> : null}
        </span>
        <ChevronDown className={`shrink-0 text-text-muted transition ${isOpen ? "rotate-180" : ""}`} size={15} />
      </button>

      <FloatingLayer
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={containerRef}
        align="start"
        offset={8}
        width={288}
        minWidth={240}
        estimatedHeight={360}
        maxHeight={520}
        mobileSheet
        className="p-2 sm:rounded-2xl"
      >
        <div className="mb-2 flex items-center justify-between px-1 sm:hidden">
          <div>
            <div className="text-sm font-bold text-text-primary">{label}</div>
            <div className="text-xs text-text-secondary">{placeholder}</div>
          </div>
          <button className="icon-btn" type="button" onClick={() => setIsOpen(false)} aria-label="Close filter">
            <X size={15} />
          </button>
        </div>
        <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1 sm:max-h-72">
          {options.map((option) => {
            const checked = multiple ? draftValue.includes(option.value) : draftValue === option.value;
            return (
              <button
                key={option.value}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition ${
                  checked ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
                }`}
                type="button"
                onClick={() => toggleOption(option.value)}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  checked ? "border-primary bg-primary text-white" : "border-slate-300 bg-white"
                }`}>
                  {checked ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <span className="font-semibold">{option.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
          <button className="h-8 rounded-xl px-2.5 text-xs font-bold text-text-secondary transition hover:bg-slate-50 hover:text-text-primary" type="button" onClick={clearSelection}>
            Clear
          </button>
          <button className="h-8 rounded-xl bg-primary px-3 text-xs font-bold text-white transition hover:bg-primary/90" type="button" onClick={applySelection}>
            Apply
          </button>
        </div>
      </FloatingLayer>
    </div>
  );
}
