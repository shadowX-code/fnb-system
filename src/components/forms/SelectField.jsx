import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import FloatingLayer from "../ui/FloatingLayer.jsx";

/** Canonical Admin selection: portaled options, search and native form validation. */
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
  footerAction = null,
  ariaLabel,
}) {
  const [isOpen, setIsOpen] = useState(false),
    [query, setQuery] = useState("");
  const containerRef = useRef(null),
    triggerRef = useRef(null),
    optionRefs = useRef([]);
  const id = useId();
  const selectedOption = options.find(
    (option) => String(option.value) === String(value),
  );
  const filteredOptions = useMemo(
    () =>
      options.filter((option) =>
        `${option.label} ${option.description || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [options, query],
  );
  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);
  function closeSelect() {
    setIsOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }
  function selectOption(option) {
    if (!option.disabled) {
      onChange(option.value);
      closeSelect();
    }
  }
  function moveFocus(direction, from = -1) {
    const enabled = filteredOptions
      .map((o, i) => (o.disabled ? -1 : i))
      .filter((i) => i >= 0);
    if (!enabled.length) return;
    const position = enabled.indexOf(from);
    const next =
      direction === "first"
        ? enabled[0]
        : direction === "last"
          ? enabled.at(-1)
          : enabled[(position + direction + enabled.length) % enabled.length];
    optionRefs.current[next]?.focus();
  }
  function optionKey(event, index) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      moveFocus(
        event.key === "Home"
          ? "first"
          : event.key === "End"
            ? "last"
            : event.key === "ArrowDown"
              ? 1
              : -1,
        index,
      );
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSelect();
    }
    if (event.key === "Tab") setIsOpen(false);
  }
  const footerContent =
    typeof footerAction === "function"
      ? footerAction({ close: closeSelect })
      : footerAction;
  return (
    <div
      className={`admin-select relative min-w-0 ${className}`}
      ref={containerRef}
    >
      {label && (
        <div id={`${id}-label`} className="admin-form-field-label mb-2">
          {label} {required && <span className="text-rose-500">*</span>}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        className={`admin-select-trigger control ${buttonClassName}`}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label ? `${id}-label` : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${id}-options` : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error || helper ? `${id}-message` : undefined}
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        <span className={!selectedOption ? "text-text-secondary" : ""}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={isOpen ? "rotate-180" : ""}
        />
      </button>
      {required && (
        <input
          className="admin-select-validation"
          tabIndex={-1}
          aria-hidden="true"
          required
          disabled={disabled}
          value={value ?? ""}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        />
      )}
      {(error || helper) && (
        <div
          id={`${id}-message`}
          className={`admin-form-field-message mt-1 ${error ? "text-rose-600" : ""}`}
        >
          {error || helper}
        </div>
      )}
      <FloatingLayer
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) triggerRef.current?.focus();
        }}
        anchorRef={containerRef}
        minWidth={224}
        align="start"
        estimatedHeight={320}
        focusOnOpen
        className="admin-select-popover"
      >
        {searchable && (
          <div className="admin-select-search">
            <Search size={14} aria-hidden="true" />
            <input
              className="control"
              value={query}
              aria-label={`Search ${ariaLabel || label || "options"}`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveFocus("first");
                }
              }}
            />
          </div>
        )}
        <div
          id={`${id}-options`}
          role="listbox"
          aria-label={ariaLabel || label || placeholder}
          className="admin-select-options"
        >
          {filteredOptions.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="option"
              aria-selected={String(option.value) === String(value)}
              className="admin-select-option"
              type="button"
              disabled={option.disabled}
              onKeyDown={(event) => optionKey(event, index)}
              onClick={() => selectOption(option)}
            >
              <span>
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              {String(option.value) === String(value) && (
                <Check size={15} aria-hidden="true" />
              )}
            </button>
          ))}
          {!filteredOptions.length && (
            <p className="p-3 text-sm text-text-secondary">No options found</p>
          )}
        </div>
        {footerContent && (
          <div className="mt-2 border-t border-border pt-2">
            {footerContent}
          </div>
        )}
      </FloatingLayer>
    </div>
  );
}
