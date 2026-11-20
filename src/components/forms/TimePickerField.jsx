import { useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import FloatingLayer from "../ui/FloatingLayer.jsx";
import SelectField from "./SelectField.jsx";
import AdminFormField from "./AdminFormField.jsx";

const pad = (value) => String(value).padStart(2, "0");
export function formatTimeValue(value, withSeconds = false) {
  if (!value) return "";
  const [hour, minute, second = 0] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${pad(minute)}${withSeconds ? `:${pad(second)}` : ""} ${hour < 12 ? "am" : "pm"}`;
}

export default function TimePickerField({ label, ariaLabel = label, value = "", onChange, error, withSeconds = false }) {
  const anchorRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [hour, minute, second = 0] = (value || "09:00").split(":").map(Number);
  const update = (nextHour, nextMinute, nextSecond = second) => onChange(`${pad(nextHour)}:${pad(nextMinute)}${withSeconds ? `:${pad(nextSecond)}` : ""}`);
  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  return <div ref={anchorRef}>
    <AdminFormField as="div" label={label} error={error}>
    <button ref={triggerRef} type="button" className={`control flex w-full items-center gap-2 text-left ${withSeconds ? "min-h-11" : "h-10"}`} aria-label={ariaLabel} aria-expanded={open} aria-invalid={Boolean(error)} onClick={() => setOpen(!open)}><Clock3 size={16} className="shrink-0" aria-hidden="true" /><span>{formatTimeValue(value, withSeconds) || "Not set"}</span></button>
    <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={320} minWidth={280} estimatedHeight={220} className="rounded-lg border-border bg-surface p-3 shadow-xl" focusOnOpen>
      <div className={`grid gap-2 ${withSeconds ? "grid-cols-2" : "grid-cols-3"}`}>
        <SelectField label="Hour" value={hour % 12 || 12} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} onChange={(next) => update(Number(next) % 12 + (hour >= 12 ? 12 : 0), minute)} />
        <SelectField label="Minute" value={minute} options={Array.from({ length: 60 }, (_, i) => ({ value: i, label: pad(i) }))} onChange={(next) => update(hour, Number(next))} />
        {withSeconds && <SelectField label="Second" value={second} options={Array.from({ length: 60 }, (_, i) => ({ value: i, label: pad(i) }))} onChange={(next) => update(hour, minute, Number(next))} />}
        <SelectField label="Period" value={hour < 12 ? "am" : "pm"} options={[{ value: "am", label: "AM" }, { value: "pm", label: "PM" }]} onChange={(next) => update(hour % 12 + (next === "pm" ? 12 : 0), minute)} />
      </div>
      <div className="mt-3 flex justify-between gap-2"><button type="button" className="btn-secondary" onClick={() => { onChange(""); close(); }}>Clear</button><button type="button" className="btn-primary" onClick={() => { if (!value) update(hour, minute); close(); }}>Done</button></div>
    </FloatingLayer>
    </AdminFormField>
  </div>;
}
