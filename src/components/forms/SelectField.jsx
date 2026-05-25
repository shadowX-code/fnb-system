import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";

export default function SelectField({
  label,
  value,
  options = [],
  onChange,
  placeholder = "Select",
  disabled = false,
  error,
  helper,
  required = false,
  searchable = false,
  className = "",
  buttonClassName = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuRect, setMenuRect] = useState(null);
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedOption = options.find((option) => String(option.value) === String(value));
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return options;
    return options.filter((option) => String(option.label).toLowerCase().includes(search));
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function updateMenuRect() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuRect({
        top: rect.bottom + 8,
        left: rect.left,
        width: Math.max(rect.width, 224),
      });
    }

    updateMenuRect();

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [isOpen]);

  function selectOption(option) {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div className={`relative min-w-0 ${className}`} ref={containerRef}>
      {label ? (
        <div className="mb-1 type-caption font-semibold text-text-secondary">
          {label} {required ? <span className="text-rose-500">*</span> : null}
        </div>
      ) : null}
      <button
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left text-[13px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-text-muted ${
          error ? "border-rose-200" : isOpen ? "border-primary/50 shadow-sm" : "border-border hover:border-slate-300 hover:bg-slate-50"
        } ${buttonClassName}`}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={`truncate ${selectedOption ? "text-text-primary" : "text-text-secondary"}`}>{selectedOption?.label ?? placeholder}</span>
        <ChevronDown className={`shrink-0 text-text-muted transition ${isOpen ? "rotate-180" : ""}`} size={15} />
      </button>
      {error ? <div className="mt-1 type-micro font-medium text-rose-600">{error}</div> : null}
      {!error && helper ? <div className="mt-1 type-micro text-text-muted">{helper}</div> : null}

      {isOpen && menuRect ? createPortal((
        <div
          ref={menuRef}
          className="fixed inset-x-0 bottom-0 z-[9999] max-h-[78vh] rounded-t-3xl border border-border bg-white p-3 shadow-2xl animate-in slide-in-from-bottom-2 duration-150 sm:inset-auto sm:bottom-auto sm:rounded-2xl sm:p-2 sm:shadow-xl sm:animate-in sm:fade-in-0 sm:zoom-in-95"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          <div className="mb-2 flex items-center justify-between px-1 sm:hidden">
            <div className="type-body font-bold text-text-primary">{label || placeholder}</div>
            <button className="icon-btn" type="button" onClick={() => setIsOpen(false)} aria-label="Close select">
              <X size={15} />
            </button>
          </div>
          {searchable ? (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={14} />
              <input
                className="control h-8 w-full pl-8 text-[13px]"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search..."
                autoFocus
              />
            </div>
          ) : null}
          <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1 sm:max-h-72">
            {filteredOptions.length ? filteredOptions.map((option) => {
              const checked = String(option.value) === String(value);
              return (
                <button
                  key={option.value}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] transition ${
                    option.disabled
                      ? "cursor-not-allowed text-text-muted opacity-50"
                      : checked
                        ? "bg-primary/10 text-primary"
                        : "text-text-secondary hover:bg-slate-50 hover:text-text-primary"
                  }`}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => selectOption(option)}
                >
                  <span className="truncate font-semibold">{option.label}</span>
                  {checked ? <Check size={14} strokeWidth={3} /> : null}
                </button>
              );
            }) : (
              <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs font-semibold text-text-muted">No options found</div>
            )}
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}
