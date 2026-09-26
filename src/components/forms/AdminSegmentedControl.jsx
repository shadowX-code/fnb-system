import { useRef } from "react";

export default function AdminSegmentedControl({ value, onChange, options, label = "View", className = "" }) {
  const refs = useRef([]);
  function moveFocus(event, index) {
    const enabled = options.map((option, optionIndex) => ({ option, optionIndex })).filter(({ option }) => !option.disabled);
    const current = enabled.findIndex(({ optionIndex }) => optionIndex === index);
    if (current < 0) return;
    const destination = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : event.key === "ArrowRight" || event.key === "ArrowDown" ? enabled[(current + 1) % enabled.length] : event.key === "ArrowLeft" || event.key === "ArrowUp" ? enabled[(current - 1 + enabled.length) % enabled.length] : null;
    if (!destination) return;
    event.preventDefault();
    refs.current[destination.optionIndex]?.focus();
    onChange(destination.option.value);
  }
  const focusIndex = options.findIndex(option => option.value === value && !option.disabled);
  const entryIndex = focusIndex < 0 ? options.findIndex(option => !option.disabled) : focusIndex;
  return <div className={`admin-segmented-control ${className}`.trim()} role="tablist" aria-label={label}>{options.map((option, index) => { const active = option.value === value; return <button key={option.value} ref={(element) => { refs.current[index] = element; }} className={active ? "is-active" : ""} type="button" role="tab" aria-selected={active} aria-controls={option.panelId} tabIndex={index === entryIndex ? 0 : -1} disabled={option.disabled} onKeyDown={(event) => moveFocus(event, index)} onClick={() => onChange(option.value)}>{option.label}</button>; })}</div>;
}
