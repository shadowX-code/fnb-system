import { useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import FloatingLayer from "../ui/FloatingLayer.jsx";
import SelectField from "./SelectField.jsx";

const pad = (value) => String(value).padStart(2, "0");
export function formatTimeValue(value) {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? "am" : "pm"}`;
}

export default function TimePickerField({ label, value = "", onChange, error }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [hour, minute] = (value || "09:00").split(":").map(Number);
  const update = (nextHour, nextMinute) => onChange(`${pad(nextHour)}:${pad(nextMinute)}`);
  return <div className="field" ref={anchorRef}>
    <span>{label}</span>
    <button type="button" className="control flex h-10 w-full items-center gap-2 text-left" aria-label={label} aria-expanded={open} aria-invalid={Boolean(error)} onClick={() => setOpen(!open)}><Clock3 size={16} aria-hidden="true" /><span>{formatTimeValue(value) || "Not set"}</span></button>
    {error ? <span className="admin-form-field-message text-danger">{error}</span> : null}
    <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={320} minWidth={280} estimatedHeight={220} className="rounded-lg border-border bg-surface p-3 shadow-xl">
      <div className="grid grid-cols-3 gap-2">
        <SelectField label="Hour" value={hour % 12 || 12} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} onChange={(next) => update(Number(next) % 12 + (hour >= 12 ? 12 : 0), minute)} />
        <SelectField label="Minute" value={minute} options={Array.from({ length: 60 }, (_, i) => ({ value: i, label: pad(i) }))} onChange={(next) => update(hour, Number(next))} />
        <SelectField label="Period" value={hour < 12 ? "am" : "pm"} options={[{ value: "am", label: "AM" }, { value: "pm", label: "PM" }]} onChange={(next) => update(hour % 12 + (next === "pm" ? 12 : 0), minute)} />
      </div>
      <div className="mt-3 flex justify-between gap-2"><button type="button" className="btn-secondary" onClick={() => { onChange(""); setOpen(false); }}>Clear</button><button type="button" className="btn-primary" onClick={() => { if (!value) update(hour, minute); setOpen(false); }}>Done</button></div>
    </FloatingLayer>
  </div>;
}
