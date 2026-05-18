import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyMatch(option, query) {
  const term = normalize(query);
  if (!term) return true;
  const name = normalize(option.name);
  if (name.includes(term)) return true;

  let cursor = 0;
  for (const char of name) {
    if (char === term[cursor]) cursor += 1;
    if (cursor === term.length) return true;
  }
  return false;
}

export default function SupplierCombobox({
  suppliers,
  value,
  disabled,
  error,
  autoFocus,
  onChange,
  onCreate,
}) {
  const selected = suppliers.find((supplier) => supplier.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState(null);
  const wrapperRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setQuery(selected?.name ?? "");
  }, [selected?.name]);

  useEffect(() => {
    if (autoFocus && !disabled) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [autoFocus, disabled]);

  useEffect(() => {
    function handleClick(event) {
      if (wrapperRef.current?.contains(event.target) || dropdownRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    function updatePosition() {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        left: rect.left,
        top: rect.bottom + 6,
        width: Math.min(rect.width, 320),
      });
    }

    if (!open) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const options = useMemo(
    () => suppliers.filter((supplier) => supplier.status === "active" && fuzzyMatch(supplier, query)).slice(0, 8),
    [query, suppliers],
  );
  const exactMatch = suppliers.some((supplier) => normalize(supplier.name) === normalize(query));
  const canCreate = query.trim().length > 1 && !exactMatch;

  function selectSupplier(supplier) {
    onChange(supplier);
    setQuery(supplier.name);
    setOpen(false);
  }

  function createSupplier() {
    const name = query.trim();
    if (!name) return;
    onCreate(name);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-full">
      <div className="relative">
        {!selected ? <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} /> : null}
        <input
          ref={inputRef}
          className={`control w-full truncate ${selected ? "pl-3 pr-14" : "pl-9 pr-10"} ${error ? "border-amber-300 bg-amber-50/60" : ""}`}
          disabled={disabled}
          value={query}
          placeholder="Type supplier..."
          title={selected?.name ?? query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            if (!event.target.value) onChange(null);
          }}
          onKeyDown={(event) => {
            if (!open && ["ArrowDown", "Enter"].includes(event.key)) {
              setOpen(true);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              const maxIndex = Math.max(0, options.length + (canCreate ? 0 : -1));
              setActiveIndex((current) => Math.min(current + 1, maxIndex));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (options[activeIndex]) selectSupplier(options[activeIndex]);
              else if (canCreate) createSupplier();
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {selected ? (
            <button
              className="rounded-lg p-1 text-text-muted hover:bg-slate-100"
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(null);
                setQuery("");
                setOpen(true);
                inputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          ) : null}
          <ChevronDown size={15} className="text-text-muted" />
        </div>
      </div>

      {open && !disabled && position
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[9999] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-slate-900/5"
              style={{ left: position.left, top: position.top, width: position.width }}
            >
              <div className="max-h-72 overflow-y-auto py-1">
                {options.map((supplier, index) => (
                  <button
                    key={supplier.id}
                    type="button"
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${
                      index === activeIndex ? "bg-primary/[0.06] text-text-primary" : "hover:bg-slate-50"
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectSupplier(supplier)}
                  >
                    <span className="min-w-0 truncate font-semibold">{supplier.name}</span>
                    {supplier.id === value ? <Check className="text-primary" size={14} /> : null}
                  </button>
                ))}

                {!options.length ? (
                  <div className="px-3 py-3 text-sm text-text-secondary">No matching supplier found.</div>
                ) : null}

                {canCreate ? (
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm font-semibold text-primary transition hover:bg-primary/5 ${
                      activeIndex >= options.length ? "bg-primary/5" : ""
                    }`}
                    onMouseEnter={() => setActiveIndex(options.length)}
                    onClick={createSupplier}
                  >
                    <Plus size={15} />
                    Create new supplier "{query.trim()}"
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
